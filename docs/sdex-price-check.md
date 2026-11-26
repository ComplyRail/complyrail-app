# SDEX Trade-Aggregation Price Cross-Check

The ComplyRail dashboard shows payment amounts in the asset's own units. When an
operator needs to review whether a payment amount is reasonable, they can compare
the declared value against the current market price from the **Stellar
Decentralized Exchange (SDEX)**.

SDEX prices are native to the Stellar network and do not depend on any external
oracle. They are derived from real, settled on-chain trades and therefore provide
an independent cross-check against oracle-reported prices.

## How it works

`lib/sdex.ts` exports `fetchSdexPrice`, which calls Horizon's
`/trade_aggregations` endpoint and returns the latest closed bucket's mid-price
(arithmetic mean of open and close) and volume-weighted average price (VWAP).

```ts
import { fetchSdexPrice } from '@/lib/sdex'

const price = await fetchSdexPrice({
  baseAsset:    { type: 'native' },
  counterAsset: {
    type:   'credit_alphanum4',
    code:   'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  resolution: 3_600_000, // 1-hour buckets
})

if (price) {
  console.log(`SDEX mid-price: ${price.mid} USDC/XLM`)
  console.log(`VWAP: ${price.vwap}`)
  console.log(`Trades in bucket: ${price.tradeCount}`)
}
```

## Comparing with an oracle price

`comparePrices` checks whether an oracle price and the SDEX mid-price are within
a configurable percentage tolerance:

```ts
import { fetchSdexPrice, comparePrices } from '@/lib/sdex'

const sdex = await fetchSdexPrice({ baseAsset: { type: 'native' }, counterAsset: ... })
if (sdex) {
  const result = comparePrices(oraclePriceFromContract, sdex, 5 /* % */)
  if (!result.withinTolerance) {
    console.warn(
      `Price divergence: oracle ${result.oraclePrice}, ` +
      `SDEX mid ${result.sdexMid.toFixed(7)} ` +
      `(${result.divergencePct.toFixed(2)} %)`,
    )
  }
}
```

## API reference

### `fetchSdexPrice(opts)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseAsset` | `HorizonAsset` | required | Base asset (the asset you are pricing) |
| `counterAsset` | `HorizonAsset` | required | Counter asset (the quote currency) |
| `resolution` | `number` (ms) | `3_600_000` | Bucket duration. Supported values: 60 000, 300 000, 900 000, 3 600 000, 86 400 000, 604 800 000 |
| `horizonUrl` | `string` | testnet Horizon | Horizon base URL |
| `limit` | `number` | `10` | Maximum number of buckets to request |

Returns `SdexPrice | null`. Returns `null` when no trades were found in the
requested window.

### `comparePrices(oraclePrice, sdexPrice, tolerancePct?)`

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `oraclePrice` | `number` | required | Price from the on-chain oracle (counter per base) |
| `sdexPrice` | `SdexPrice` | required | Result from `fetchSdexPrice` |
| `tolerancePct` | `number` | `5` | Maximum allowed percentage divergence |

Returns `{ withinTolerance, divergencePct, sdexMid, oraclePrice }`.

## Limitations

- SDEX prices are **historical**: the latest closed bucket may be minutes to
  hours old depending on the `resolution` chosen and market activity.
- Low-volume or newly listed pairs may return `null` or unreliable prices.
  Always check `tradeCount` before treating the mid-price as authoritative.
- Horizon testnet data may be reset periodically; do not rely on historical
  aggregations for production decisions.

## References

- [Horizon trade_aggregations endpoint](https://developers.stellar.org/docs/data/horizon/api-reference/resources/trade-aggregations)
- [Stellar DEX overview](https://developers.stellar.org/docs/learn/fundamentals/stellar-dex/dex-and-protocol)
