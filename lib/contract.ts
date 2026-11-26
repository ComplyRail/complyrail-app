import { contract, rpc, scValToNative, xdr } from '@stellar/stellar-sdk'
import { ASSETS, JURISDICTIONS, config, isContractConfigured } from './config'
import { bytesToHex, fromUnits, hexToBytes, parseVaspKey } from './format'
import { withRetry } from './retry'
import {
  AuditEvent,
  AuditEventType,
  PaymentRecord,
  PaymentStatus,
  ThresholdRow,
  VaspEntry,
  VaspStatus,
  IVMS101_VERSION,
} from './types'

// ---------------------------------------------------------------------------
// Raw shapes returned by the contract spec (snake_case, bigint, Buffer, tagged enums)
// ---------------------------------------------------------------------------

type Tagged = { tag: string; values?: unknown }

export interface RawVasp {
  address: string
  name: string
  jurisdiction: string
  public_key: Uint8Array
  status: Tagged
  added_at: bigint
  expires_at?: bigint | null
}

export interface RawPayment {
  id: bigint
  from_vasp: string
  to_vasp: string
  beneficiary: string
  asset: string
  amount: bigint
  status: Tagged
  requires_attestation: boolean
  attestation_hash?: Uint8Array | null
  external_ref?: Uint8Array | null
  ivms_version?: string | null
  attested_at?: bigint | null
  created_at: bigint
  created_ledger: number
  expires_at: bigint
  resolved_at?: bigint | null
  resolved_ledger?: number | null
}

const optNum = (v?: bigint | null) => (v === undefined || v === null ? undefined : Number(v))

export function mapVasp(r: RawVasp): VaspEntry {
  return {
    address: r.address,
    name: r.name,
    jurisdiction: r.jurisdiction,
    publicKey: bytesToHex(r.public_key),
    status: r.status.tag.toLowerCase() as VaspStatus,
    addedAt: Number(r.added_at),
    expiresAt: optNum(r.expires_at),
  }
}

export function mapPayment(r: RawPayment): PaymentRecord {
  return {
    id: r.id.toString(),
    fromVasp: r.from_vasp,
    toVasp: r.to_vasp,
    beneficiary: r.beneficiary,
    asset: r.asset,
    amount: r.amount.toString(),
    status: r.status.tag.toLowerCase() as PaymentStatus,
    requiresAttestation: r.requires_attestation,
    attestationHash: r.attestation_hash ? bytesToHex(r.attestation_hash) : undefined,
    externalRef: r.external_ref ? bytesToHex(r.external_ref) : undefined,
    ivmsVersion: r.ivms_version ?? undefined,
    attestedAt: optNum(r.attested_at),
    createdAt: Number(r.created_at),
    createdLedger: Number(r.created_ledger),
    expiresAt: Number(r.expires_at),
    resolvedAt: optNum(r.resolved_at),
    resolvedLedger: r.resolved_ledger == null ? undefined : Number(r.resolved_ledger),
  }
}

const tag = (t: string): Tagged => ({ tag: t, values: undefined })

export function vaspStatusArg(s: VaspStatus): Tagged {
  return tag(s.charAt(0).toUpperCase() + s.slice(1))
}

/** Contract methods returning Result<T, Error> come back as Ok/Err objects. */
export function unwrap<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'unwrap' in value && typeof (value as { unwrap: unknown }).unwrap === 'function') {
    return (value as { unwrap: () => T }).unwrap()
  }
  return value as T
}

const EVENT_LABELS: Record<AuditEventType, string> = {
  vasp_reg: 'VASP registered',
  vasp_upd: 'VASP updated',
  thr_set: 'Threshold set',
  admin_chg: 'Admin transferred',
  adm_prop: 'Admin proposed',
  adm_acc: 'Admin accepted',
  pay_sub: 'Payment submitted',
  att_sub: 'Attestation submitted',
  pay_rel: 'Payment released',
  pay_rej: 'Payment rejected',
  pay_recl: 'Payment reclaimed',
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (v instanceof Uint8Array) return bytesToHex(v)
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'object' && 'tag' in (v as object)) return String((v as Tagged).tag)
  return String(v)
}

/** Turn a decoded contract event into an audit row. Exported for tests. */
export function mapEvent(e: {
  id: string
  ledger: number
  ledgerClosedAt: string
  txHash: string
  topics: unknown[]
  data: unknown
}): AuditEvent | null {
  const type = e.topics[0] as AuditEventType
  // Own-property check only: `in` would also match inherited keys such as `toString`.
  if (!Object.prototype.hasOwnProperty.call(EVENT_LABELS, type)) return null
  const details: Record<string, string> = {}
  if (e.data && typeof e.data === 'object' && !(e.data instanceof Uint8Array)) {
    for (const [k, v] of Object.entries(e.data as Record<string, unknown>)) details[k] = stringify(v)
  }
  if (details.amount && (type === 'pay_sub' || type === 'pay_rel' || type === 'pay_recl' || type === 'thr_set')) {
    details.amount = fromUnits(details.amount)
  }
  if (type === 'thr_set') {
    if (details.previous) {
      details.previous = fromUnits(details.previous)
    } else {
      delete details.previous
    }
  }
  return {
    id: e.id,
    ledger: e.ledger,
    timestamp: Math.floor(new Date(e.ledgerClosedAt).getTime() / 1000),
    txHash: e.txHash,
    type,
    subject: stringify(e.topics[1]),
    description: EVENT_LABELS[type],
    details,
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type Signer = Pick<contract.ClientOptions, 'signTransaction'> & {
  publicKey: string
  /** Wallet kit module ID, so clients are keyed per wallet as well as per address. */
  walletId: string
}

type AnyClient = contract.Client & Record<string, (args?: any) => Promise<contract.AssembledTransaction<any>>>

/**
 * Cache lifetime: one client per (wallet ID, public key), kept until the
 * wallet disconnects. A client captures the wallet's `signTransaction` closure
 * when it is created, so a stale entry would sign with an old signer. The
 * wallet provider calls `clearClientCache()` on disconnect.
 */
const clients = new Map<string, Promise<AnyClient>>()

/** Drop every cached client so the next call builds one with the current signer. */
export function clearClientCache(): void {
  clients.clear()
}

function assertConfigured() {
  if (!isContractConfigured) {
    throw new Error('The ComplyRail contract is not deployed yet. Run the "Deploy to testnet" GitHub Action.')
  }
}

async function getClient(signer?: Signer): Promise<AnyClient> {
  assertConfigured()
  const key = signer ? `${signer.walletId}:${signer.publicKey}` : '__read__'
  if (!clients.has(key)) {
    clients.set(
      key,
      contract.Client.from({
        contractId: config.contractId,
        rpcUrl: config.rpcUrl,
        networkPassphrase: config.networkPassphrase,
        publicKey: signer?.publicKey,
        signTransaction: signer?.signTransaction,
      }).then(c => c as AnyClient),
    )
  }
  return clients.get(key)!
}

/** Reads are idempotent, so transient RPC failures are retried. Writes are never retried. */
async function read<T>(method: string, args?: Record<string, unknown>): Promise<T> {
  return withRetry(async () => {
    const c = await getClient()
    const tx = await c[method](args)
    return unwrap<T>(tx.result)
  })
}

/** A transaction was included in a ledger but failed on-chain. Carries the hash for inspection. */
export class TxFailedError extends Error {
  readonly txHash: string

  constructor(txHash: string) {
    super('The transaction was included on-chain but failed.')
    this.name = 'TxFailedError'
    this.txHash = txHash
  }
}

/**
 * Extract the resource fee for a simulated transaction, in stroops, as a
 * human-readable decimal XLM string.
 *
 * Soroban transactions carry two fee components:
 *   - inclusion fee  – bid to get into the ledger (like a classic transaction fee)
 *   - resource fee   – cost of CPU, memory and I/O consumed by the contract
 *
 * The simulation returns `minResourceFee` (the floor set by the validators).
 * The assembled transaction's `built.fee` is their sum. We surface the resource
 * fee separately so users can understand the charge before they sign.
 *
 * Returns `null` when the transaction has not yet been simulated.
 */
export function resourceFeeXlm(tx: contract.AssembledTransaction<unknown>): string | null {
  const sim = tx.simulation as (rpc.Api.SimulateTransactionResponse & { minResourceFee?: string }) | undefined
  const stroops = sim?.minResourceFee ? parseInt(sim.minResourceFee, 10) : null
  if (stroops === null || isNaN(stroops)) return null
  // 1 XLM = 10 000 000 stroops (7 decimal places).
  return (stroops / 10_000_000).toFixed(7).replace(/\.?0+$/, '') || '0'
}

async function write<T>(signer: Signer, method: string, args: Record<string, unknown>): Promise<T> {
  const c = await getClient(signer)
  const tx = await c[method](args)
  // Surface contract errors from simulation before asking the wallet to sign.
  unwrap(tx.result)

  // Notify the caller of the resource fee so the UI can show it to the user
  // before the wallet approval dialog opens (issue #1013).
  const fee = resourceFeeXlm(tx)
  if (fee !== null && typeof window !== 'undefined') {
    // Dispatch a custom DOM event that the TxStatus component listens for.
    window.dispatchEvent(new CustomEvent('complyrail:resourcefee', { detail: { fee } }))
  }

  const sent = await tx.signAndSend()
  // Check the final status before reading the result, so a FAILED transaction
  // is never reported as success.
  if (sent.getTransactionResponse?.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new TxFailedError(sent.sendTransactionResponse?.hash ?? '')
  }
  return unwrap<T>(sent.result)
}

// ----- reads ---------------------------------------------------------------

/** Max simultaneous RPC simulations per list. The public testnet RPC rate-limits bursts. */
export const RPC_CONCURRENCY = 5

/** Runs `fn` over `items` with at most `limit` calls in flight. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

export async function getAdmin(): Promise<string> {
  return read<string>('admin')
}

/** On-chain check: registered, `Active` and not expired (contract `is_vasp_active`). */
export async function isVaspActive(address: string): Promise<boolean> {
  return read<boolean>('is_vasp_active', { address })
}

export async function getThresholdAdmin(): Promise<string> {
  return read<string>('threshold_admin')
}

/** Page size for `list_vasps`; the contract caps a single page at 100. */
const VASP_PAGE_SIZE = 100

/** Address proposed by `propose_admin` and not yet accepted, if any. */
export async function getPendingAdmin(): Promise<string | null> {
  return (await read<string | null | undefined>('pending_admin')) ?? null
}

export async function listVasps(): Promise<VaspEntry[]> {
  const count = await read<number>('vasp_count')
  const addresses: string[] = []
  for (let start = 0; start < count; start += VASP_PAGE_SIZE) {
    addresses.push(...await read<string[]>('list_vasps', { start, limit: VASP_PAGE_SIZE }))
  }
  const raws = await mapLimit(addresses, RPC_CONCURRENCY, address => read<RawVasp>('get_vasp', { address }))
  return raws.map(mapVasp)
}

export async function getVasp(address: string): Promise<VaspEntry | null> {
  try {
    return mapVasp(await read<RawVasp>('get_vasp', { address }))
  } catch {
    return null
  }
}

/** Newest first, capped at `limit`. */
export async function listPayments(limit = 100): Promise<PaymentRecord[]> {
  const count = Number(await read<bigint>('payment_count'))
  const ids = Array.from({ length: Math.min(count, limit) }, (_, i) => BigInt(count - 1 - i))
  const raws = await mapLimit(ids, RPC_CONCURRENCY, payment_id => read<RawPayment>('get_payment', { payment_id }))
  return raws.map(mapPayment)
}

/** Must match the contract's `MAX_PAGE_SIZE`. */
export const PAYMENT_PAGE_SIZE = 100

/**
 * Ids `[start, start + limit)` for the page of payments that sits just below
 * `cursor` (ids `< cursor` are still unread). `cursor` 0 means nothing is left.
 */
export function pageBounds(cursor: number, size = PAYMENT_PAGE_SIZE): { start: number; limit: number } {
  const start = Math.max(0, cursor - size)
  return { start, limit: cursor - start }
}

export interface PaymentPage {
  /** Newest first. */
  payments: PaymentRecord[]
  /** Pass to `listPaymentsPage` for the next (older) page; 0 when none is left. */
  nextCursor: number
  /** Total payments on the contract. Present on the first page only. */
  total?: number
}

/**
 * One page of payments, newest first. The first page (no cursor) costs two
 * reads (`payment_count`, `list_payments`); later pages cost one.
 */
export async function listPaymentsPage(cursor?: number): Promise<PaymentPage> {
  const total = cursor === undefined ? Number(await read<bigint>('payment_count')) : undefined
  const end = cursor ?? total ?? 0
  const { start, limit } = pageBounds(end)
  if (limit === 0) return { payments: [], nextCursor: 0, total }
  const raws = await read<RawPayment[]>('list_payments', { start: BigInt(start), limit })
  return { payments: raws.map(mapPayment).reverse(), nextCursor: start, total }
}

/** Payments involving one VASP, in submission order (oldest first). */
export async function listPaymentsByVasp(vasp: string, start = 0, limit = PAYMENT_PAGE_SIZE): Promise<PaymentRecord[]> {
  const raws = await read<RawPayment[]>('list_payments_by_vasp', { vasp, start: BigInt(start), limit })
  return raws.map(mapPayment)
}

/**
 * Returns the payment, or `null` when the contract reports it does not exist.
 * Transport and other failures are thrown so callers can distinguish a load
 * error from a confirmed missing payment.
 */
export async function getPayment(id: string): Promise<PaymentRecord | null> {
  try {
    return mapPayment(await read<RawPayment>('get_payment', { payment_id: BigInt(id) }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Contract error 7 = "Payment not found" (contracts/complyrail/src/lib.rs).
    if (/Error\(Contract, #7\)/.test(msg)) return null
    throw e
  }
}

/** Decoded `(asset, jurisdiction, amount)` tuples from `list_thresholds`. */
export type RawThreshold = [string, string, bigint | number | string]

export function mapThresholds(rows: RawThreshold[]): ThresholdRow[] {
  return rows
    .map(([asset, jurisdiction, amount]) => ({ asset, jurisdiction, amount: BigInt(amount) }))
    .filter(r => r.amount > 0n)
}

export interface AuditWindow {
  startLedger: number
  latestLedger: number
  /** Unix seconds when the window's first ledger closed. Estimated if the RPC cannot report it. */
  since: number
  /** True when the wide window failed and the narrow fallback window was used. */
  fallback: boolean
  fallbackReason?: string
}

export interface AuditEventsResult {
  /** Newest first. */
  events: AuditEvent[]
  /** True when the page cap was reached before the window was exhausted; older events are missing. */
  truncated: boolean
  window: AuditWindow
}

const WIDE_WINDOW_LEDGERS = 115_000
const NARROW_WINDOW_LEDGERS = 17_000
/** Average testnet ledger interval, used only when the RPC cannot report the close time. */
const LEDGER_SECONDS = 5

async function windowSince(server: Pick<rpc.Server, 'getLedgers'>, startLedger: number, latest: number): Promise<number> {
  try {
    const res = await server.getLedgers({ startLedger, pagination: { limit: 1 } })
    const closedAt = res.ledgers[0]?.ledgerCloseTime
    // RPC sends a Unix timestamp string; accept an ISO date too.
    const seconds = closedAt ? Number(closedAt) : NaN
    if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds)
    const parsed = closedAt ? Date.parse(closedAt) : NaN
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
  } catch {
    // Fall through to the estimate; the window itself is still valid.
  }
  return Math.floor(Date.now() / 1000) - (latest - startLedger) * LEDGER_SECONDS
}

/** RPC page size for getEvents (the RPC maximum). */
export const AUDIT_PAGE_SIZE = 1000
/** Stop following cursors after this many pages (10,000 events). */
export const AUDIT_MAX_PAGES = 10

/**
 * Follows getEvents cursors from `startLedger` until a short page (window exhausted)
 * or `AUDIT_MAX_PAGES` full pages (truncated). The RPC rejects startLedger alongside
 * a cursor, so only the first request sets it.
 */
export async function fetchAllContractEvents(
  server: Pick<rpc.Server, 'getEvents'>,
  contractId: string,
  startLedger: number,
): Promise<{ events: rpc.Api.EventResponse[]; truncated: boolean }> {
  const filters = [{ type: 'contract' as const, contractIds: [contractId] }]
  const events: rpc.Api.EventResponse[] = []
  let res = await server.getEvents({ startLedger, filters, limit: AUDIT_PAGE_SIZE })
  for (let page = 1; ; page++) {
    events.push(...res.events)
    if (res.events.length < AUDIT_PAGE_SIZE) return { events, truncated: false }
    if (page >= AUDIT_MAX_PAGES) return { events, truncated: true }
    res = await server.getEvents({ cursor: res.cursor, filters, limit: AUDIT_PAGE_SIZE })
  }
}

/** Every configured (non-zero) threshold, in a single contract read. */
export async function listThresholds(): Promise<ThresholdRow[]> {
  return mapThresholds(await read<RawThreshold[]>('list_thresholds'))
}

/** Contract events from the RPC's retention window (about 7 days on testnet). */
export async function listAuditEvents(): Promise<AuditEventsResult> {
  assertConfigured()
  const server = new rpc.Server(config.rpcUrl)
  const latest = (await server.getLatestLedger()).sequence
  const attempt = async (span: number) => {
    const startLedger = Math.max(1, latest - span)
    const result = await fetchAllContractEvents(server, config.contractId, startLedger)
    return { ...result, startLedger }
  }
  let fallback = false
  let fallbackReason: string | undefined
  let window: Awaited<ReturnType<typeof attempt>>
  try {
    window = await attempt(WIDE_WINDOW_LEDGERS)
  } catch (e) {
    fallback = true
    fallbackReason = e instanceof Error ? e.message : String(e)
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[audit] wide event window failed, using ${NARROW_WINDOW_LEDGERS}-ledger fallback:`, fallbackReason)
    }
    window = await attempt(NARROW_WINDOW_LEDGERS)
  }
  const events = window.events
    .map(ev =>
      mapEvent({
        id: ev.id,
        ledger: ev.ledger,
        ledgerClosedAt: ev.ledgerClosedAt,
        txHash: ev.txHash,
        topics: ev.topic.map((t: xdr.ScVal) => scValToNative(t)),
        data: scValToNative(ev.value),
      }),
    )
    .filter((e): e is AuditEvent => e !== null)
    .reverse()
  return {
    events,
    truncated: window.truncated,
    window: {
      startLedger: window.startLedger,
      latestLedger: latest,
      since: await windowSince(server, window.startLedger, latest),
      fallback,
      fallbackReason,
    },
  }
}

/**
 * Balance of `owner` for a Stellar Asset Contract, in integer units. Read-only:
 * simulates the SAC `balance` method, so nothing is signed.
 */
export async function getAssetBalance(asset: string, owner: string): Promise<bigint> {
  const sac = (await contract.Client.from({
    contractId: asset,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
  })) as AnyClient
  const tx = await sac.balance({ id: owner })
  return BigInt(unwrap<bigint | number | string>(tx.result))
}

// ----- writes --------------------------------------------------------------

export function registerVasp(
  signer: Signer,
  v: { address: string; name: string; jurisdiction: string; publicKeyHex: string; expiresAt?: number },
) {
  return write<void>(signer, 'register_vasp', {
    address: v.address,
    name: v.name,
    jurisdiction: v.jurisdiction,
    public_key: parseVaspKey(v.publicKeyHex),
    expires_at: v.expiresAt === undefined ? undefined : BigInt(v.expiresAt),
  })
}

export function setVaspStatus(signer: Signer, address: string, status: VaspStatus, reason: string) {
  return write<void>(signer, 'set_vasp_status', { address, status: vaspStatusArg(status), reason })
}

export function setVaspExpiry(signer: Signer, address: string, expiresAt?: number) {
  return write<void>(signer, 'set_vasp_expiry', {
    address,
    expires_at: expiresAt === undefined ? undefined : BigInt(expiresAt),
  })
}

// ----- admin handover (two steps) -------------------------------------------

/** Step 1, signed by the current admin. */
export function proposeAdmin(signer: Signer, newAdmin: string) {
  return write<void>(signer, 'propose_admin', { new_admin: newAdmin })
}

/** Step 2, signed by the proposed admin. */
export function acceptAdmin(signer: Signer) {
  return write<void>(signer, 'accept_admin', { caller: signer.publicKey })
}

/** Signed by the current admin to withdraw a pending proposal. */
export function cancelAdminProposal(signer: Signer) {
  return write<void>(signer, 'cancel_admin_proposal', {})
}

export function setThreshold(signer: Signer, asset: string, jurisdiction: string, amount: bigint) {
  return write<void>(signer, 'set_threshold', { asset, jurisdiction, amount })
}

/** Optional 32-byte external reference as hex, or undefined when blank. Throws on malformed hex. */
export function externalRefArg(hex?: string): Uint8Array | undefined {
  const trimmed = hex?.trim()
  if (!trimmed) return undefined
  const bytes = hexToBytes(trimmed)
  if (bytes.length !== 32) throw new Error('External reference must be 32 bytes (64 hex characters)')
  return bytes
}

export async function submitPayment(
  signer: Signer,
  p: { toVasp: string; beneficiary: string; asset: string; amount: bigint; externalRef?: string },
): Promise<string> {
  const id = await write<bigint>(signer, 'submit_payment', {
    from_vasp: signer.publicKey,
    to_vasp: p.toVasp,
    beneficiary: p.beneficiary,
    asset: p.asset,
    amount: p.amount,
    external_ref: externalRefArg(p.externalRef),
  })
  return id.toString()
}

export function submitAttestation(signer: Signer, paymentId: string, hashHex: string, ivmsVersion: string) {
  return write<void>(signer, 'submit_attestation', {
    payment_id: BigInt(paymentId),
    attestation_hash: hexToBytes(hashHex),
    ivms_version: ivmsVersion,
  })
}

export function releasePayment(signer: Signer, paymentId: string) {
  return write<void>(signer, 'release_payment', { payment_id: BigInt(paymentId), caller: signer.publicKey })
}

export function rejectPayment(signer: Signer, paymentId: string, reason: string, evidenceHashHex?: string) {
  return write<void>(signer, 'reject_payment', {
    payment_id: BigInt(paymentId),
    caller: signer.publicKey,
    reason,
    evidence_hash: evidenceHashHex ? hexToBytes(evidenceHashHex) : undefined,
  })
}

export function reclaimExpired(signer: Signer, paymentId: string) {
  return write<void>(signer, 'reclaim_expired', { payment_id: BigInt(paymentId) })
}

/**
 * Close time of the latest ledger on the RPC node, in unix seconds. Use this for
 * expiry checks instead of the browser clock, which may be wrong.
 */
export async function getLedgerTime(): Promise<number> {
  const server = new rpc.Server(config.rpcUrl)
  const latest = (await server.getLatestLedger()).sequence
  const res = await server.getLedgers({ startLedger: latest, pagination: { limit: 1 } })
  return res.latestLedgerCloseTime
}

// ----- IVMS101 -------------------------------------------------------------

/**
 * Minimal IVMS101-shaped payload. The full payload is exchanged off-chain
 * between VASPs; only its sha256 goes on-chain.
 */
export function buildIvmsPayload(p: {
  paymentId: string
  originatorName: string
  originatorAccount: string
  beneficiaryName: string
  beneficiaryAccount: string
  amount: string
  asset: string
}) {
  return {
    ivms101Version: IVMS101_VERSION,
    paymentId: p.paymentId,
    originator: {
      originatorPersons: [{ naturalPerson: { name: { nameIdentifier: [{ primaryIdentifier: p.originatorName }] } } }],
      accountNumber: [p.originatorAccount],
    },
    beneficiary: {
      beneficiaryPersons: [{ naturalPerson: { name: { nameIdentifier: [{ primaryIdentifier: p.beneficiaryName }] } } }],
      accountNumber: [p.beneficiaryAccount],
    },
    transfer: { amount: p.amount, asset: p.asset },
  }
}

/**
 * Canonical JSON per RFC 8785 (JSON Canonicalization Scheme): no whitespace,
 * object keys sorted by UTF-16 code units, and numbers in ES Number format.
 * Two implementations that agree on the object produce the same bytes, so
 * the hash does not depend on key order or formatting. Throws on values JSON
 * cannot represent (NaN, Infinity, bigint, functions, symbols).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonical JSON cannot encode a non-finite number')
      // JSON.stringify uses the ES Number::toString form that RFC 8785 requires.
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(v => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`
      }
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj)
        .filter(k => obj[k] !== undefined)
        .sort()
      return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
    }
    default:
      throw new TypeError(`canonical JSON cannot encode a value of type ${typeof value}`)
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(new TextEncoder().encode(text))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}
