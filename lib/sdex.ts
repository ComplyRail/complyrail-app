/**
 * SDEX trade-aggregation price fetcher.
 *
 * Stellar's SDEX order book provides native, on-network price discovery that
 * dApps can use as an independent cross-check against oracle-reported prices.
 * This module wraps Horizon's `/trade_aggregations` endpoint so the dashboard
 * can warn operators when an asset's oracle price diverges from the SDEX
 * mid-price by more than a configurable tolerance.
 *
 * Usage
 * -----
 * ```ts
 * const price = await fetchSdexPrice({
 *   baseAsset:    { type: 'native' },
 *   counterAsset: { type: 'credit_alphanum4', code: 'USDC',
 *                   issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
 *   resolution:   3600000, // 1-hour buckets
 *   horizonUrl:   'https://horizon-testnet.stellar.org',
 * })
 * // price.mid === (open + close) / 2 for the latest closed bucket
 * ```
 *
 * Resolves to `null` when Horizon returns no buckets (newly listed pair or
 * stale market).
 */

/** Stellar asset descriptor for Horizon requests. */
export type HorizonAsset =
  | { type: 'native' }
  | { type: 'credit_alphanum4' | 'credit_alphanum12'; code: string; issuer: string }

/** A single Horizon trade-aggregation bucket returned by `/trade_aggregations`. */
export interface TradeAggregation {
  /** Bucket start time as an ISO-8601 string (Horizon v2) or unix-ms string (v1). */
  timestamp: string
  /** Number of trades in this bucket. */
  trade_count: number
  /** Total base units traded (string decimal). */
  base_volume: string
  /** Total counter units traded (string decimal). */
  counter_volume: string
  /** Opening price of the bucket (counter / base). */
  open: string
  /** Highest price in the bucket. */
  high: string
  /** Lowest price in the bucket. */
  low: string
  /** Closing price of the bucket. */
  close: string
  /** Volume-weighted average price. */
  avg: string
}

/** SDEX price summary derived from the most-recent closed bucket. */
export interface SdexPrice {
  /** Simple arithmetic mid-price: (open + close) / 2 for the latest bucket. */
  mid: number
  /** Volume-weighted average price for the latest bucket. */
  vwap: number
  /** Number of trades in the bucket. */
  tradeCount: number
  /** ISO-8601 timestamp of the bucket. */
  timestamp: string
  /** Raw Horizon bucket for callers that need the full data. */
  bucket: TradeAggregation
}

export interface FetchSdexPriceOptions {
  /** Base asset (the asset you are selling / pricing). */
  baseAsset: HorizonAsset
  /** Counter asset (the asset you are buying / quoting against). */
  counterAsset: HorizonAsset
  /**
   * Bucket duration in milliseconds. Horizon supports: 60000, 300000, 900000,
   * 3600000, 86400000, 604800000. Defaults to one hour (3_600_000).
   */
  resolution?: number
  /** Horizon base URL. Defaults to the testnet public Horizon. */
  horizonUrl?: string
  /**
   * How many recent buckets to request. Only the last (most-recent) bucket with
   * trades is used for the price. Defaults to 10.
   */
  limit?: number
}

function assetParams(asset: HorizonAsset, prefix: 'base' | 'counter'): Record<string, string> {
  if (asset.type === 'native') {
    return { [`${prefix}_asset_type`]: 'native' }
  }
  return {
    [`${prefix}_asset_type`]: asset.type,
    [`${prefix}_asset_code`]: asset.code,
    [`${prefix}_asset_issuer`]: asset.issuer,
  }
}

/**
 * Fetch the most recent SDEX trade-aggregation price for an asset pair from
 * Horizon. Returns `null` when no trades are found.
 *
 * @throws when the Horizon request fails (network error or non-2xx status).
 */
export async function fetchSdexPrice(opts: FetchSdexPriceOptions): Promise<SdexPrice | null> {
  const {
    baseAsset,
    counterAsset,
    resolution = 3_600_000,
    horizonUrl = 'https://horizon-testnet.stellar.org',
    limit = 10,
  } = opts

  const now = Date.now()
  // Look back over twice the resolution window per bucket so there is always
  // at least one complete closed bucket in the response.
  const startTime = now - resolution * limit

  const params = new URLSearchParams({
    ...assetParams(baseAsset, 'base'),
    ...assetParams(counterAsset, 'counter'),
    resolution: String(resolution),
    start_time: String(startTime),
    end_time: String(now),
    limit: String(limit),
    order: 'desc',
  })

  const url = `${horizonUrl.replace(/\/$/, '')}/trade_aggregations?${params}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Horizon /trade_aggregations returned ${res.status}: ${await res.text()}`)
  }

  const json = (await res.json()) as { _embedded?: { records?: TradeAggregation[] } }
  const records = json._embedded?.records ?? []

  // The most-recent bucket with at least one trade.
  const bucket = records.find(r => Number(r.trade_count) > 0) ?? null
  if (!bucket) return null

  const open = parseFloat(bucket.open)
  const close = parseFloat(bucket.close)
  const vwap = parseFloat(bucket.avg)

  return {
    mid: (open + close) / 2,
    vwap,
    tradeCount: Number(bucket.trade_count),
    timestamp: bucket.timestamp,
    bucket,
  }
}

/**
 * Compare an oracle price against the SDEX mid-price and return whether they
 * are within the given tolerance.
 *
 * @param oraclePrice  - Price reported by the on-chain oracle (counter per base).
 * @param sdexPrice    - Price from {@link fetchSdexPrice}.
 * @param tolerancePct - Maximum allowed percentage divergence (default 5 %).
 * @returns An object describing the comparison result.
 */
export function comparePrices(
  oraclePrice: number,
  sdexPrice: SdexPrice,
  tolerancePct = 5,
): { withinTolerance: boolean; divergencePct: number; sdexMid: number; oraclePrice: number } {
  const sdexMid = sdexPrice.mid
  const divergencePct = sdexMid === 0 ? Infinity : (Math.abs(oraclePrice - sdexMid) / sdexMid) * 100
  return {
    withinTolerance: divergencePct <= tolerancePct,
    divergencePct,
    sdexMid,
    oraclePrice,
  }
}
