import { contract, rpc, scValToNative, xdr } from '@stellar/stellar-sdk'
import { config, isContractConfigured } from './config'
import { bytesToHex, fromUnits, hexToBytes } from './format'
import {
  AuditEvent,
  AuditEventType,
  PaymentRecord,
  PaymentStatus,
  ThresholdRow,
  VaspEntry,
  VaspStatus,
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
  ivms_version?: string | null
  attested_at?: bigint | null
  created_at: bigint
  expires_at: bigint
  resolved_at?: bigint | null
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
    ivmsVersion: r.ivms_version ?? undefined,
    attestedAt: optNum(r.attested_at),
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    resolvedAt: optNum(r.resolved_at),
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
  pay_sub: 'Payment submitted',
  att_sub: 'Attestation submitted',
  pay_rel: 'Payment released',
  pay_rej: 'Payment rejected',
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
  if (!(type in EVENT_LABELS)) return null
  const details: Record<string, string> = {}
  if (e.data && typeof e.data === 'object' && !(e.data instanceof Uint8Array)) {
    for (const [k, v] of Object.entries(e.data as Record<string, unknown>)) details[k] = stringify(v)
  }
  if (details.amount && (type === 'pay_sub' || type === 'pay_rel' || type === 'thr_set')) {
    details.amount = fromUnits(details.amount)
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

export type Signer = Pick<contract.ClientOptions, 'signTransaction'> & { publicKey: string }

type AnyClient = contract.Client & Record<string, (args?: any) => Promise<contract.AssembledTransaction<any>>>

const clients = new Map<string, Promise<AnyClient>>()

function assertConfigured() {
  if (!isContractConfigured) {
    throw new Error('The ComplyRail contract is not deployed yet. Run the "Deploy to testnet" GitHub Action.')
  }
}

async function getClient(signer?: Signer): Promise<AnyClient> {
  assertConfigured()
  const key = signer?.publicKey ?? '__read__'
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

async function read<T>(method: string, args?: Record<string, unknown>): Promise<T> {
  const c = await getClient()
  const tx = await c[method](args)
  return unwrap<T>(tx.result)
}

async function write<T>(signer: Signer, method: string, args: Record<string, unknown>): Promise<T> {
  const c = await getClient(signer)
  const tx = await c[method](args)
  // Surface contract errors from simulation before asking the wallet to sign.
  unwrap(tx.result)
  const sent = await tx.signAndSend()
  return unwrap<T>(sent.result)
}

// ----- reads ---------------------------------------------------------------

export async function getAdmin(): Promise<string> {
  return read<string>('admin')
}

export async function listVasps(): Promise<VaspEntry[]> {
  const addresses = await read<string[]>('list_vasps')
  const raws = await Promise.all(addresses.map(address => read<RawVasp>('get_vasp', { address })))
  return raws.map(mapVasp)
}

export async function getVasp(address: string): Promise<VaspEntry | null> {
  try {
    return mapVasp(await read<RawVasp>('get_vasp', { address }))
  } catch {
    return null
  }
}

/** Must match the contract's `MAX_PAGE_SIZE`. */
export const PAYMENT_PAGE_SIZE = 50

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

export async function getPayment(id: string): Promise<PaymentRecord | null> {
  try {
    return mapPayment(await read<RawPayment>('get_payment', { payment_id: BigInt(id) }))
  } catch {
    return null
  }
}

/** Decoded `(asset, jurisdiction, amount)` tuples from `list_thresholds`. */
export type RawThreshold = [string, string, bigint | number | string]

export function mapThresholds(rows: RawThreshold[]): ThresholdRow[] {
  return rows
    .map(([asset, jurisdiction, amount]) => ({ asset, jurisdiction, amount: BigInt(amount) }))
    .filter(r => r.amount > 0n)
}

/** Every configured (non-zero) threshold, in a single contract read. */
export async function listThresholds(): Promise<ThresholdRow[]> {
  return mapThresholds(await read<RawThreshold[]>('list_thresholds'))
}

/** Contract events from the RPC's retention window (about 7 days on testnet). */
export async function listAuditEvents(): Promise<AuditEvent[]> {
  assertConfigured()
  const server = new rpc.Server(config.rpcUrl)
  const latest = (await server.getLatestLedger()).sequence
  const fetchFrom = (startLedger: number) =>
    server.getEvents({
      startLedger,
      filters: [{ type: 'contract', contractIds: [config.contractId] }],
      limit: 1000,
    })
  let res: rpc.Api.GetEventsResponse
  try {
    res = await fetchFrom(Math.max(1, latest - 115_000))
  } catch {
    res = await fetchFrom(Math.max(1, latest - 17_000))
  }
  return res.events
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
    public_key: hexToBytes(v.publicKeyHex),
    expires_at: v.expiresAt === undefined ? undefined : BigInt(v.expiresAt),
  })
}

export function setVaspStatus(signer: Signer, address: string, status: VaspStatus) {
  return write<void>(signer, 'set_vasp_status', { address, status: vaspStatusArg(status) })
}

export function setVaspExpiry(signer: Signer, address: string, expiresAt?: number) {
  return write<void>(signer, 'set_vasp_expiry', {
    address,
    expires_at: expiresAt === undefined ? undefined : BigInt(expiresAt),
  })
}

export function setThreshold(signer: Signer, asset: string, jurisdiction: string, amount: bigint) {
  return write<void>(signer, 'set_threshold', { asset, jurisdiction, amount })
}

export async function submitPayment(
  signer: Signer,
  p: { toVasp: string; beneficiary: string; asset: string; amount: bigint },
): Promise<string> {
  const id = await write<bigint>(signer, 'submit_payment', {
    from_vasp: signer.publicKey,
    to_vasp: p.toVasp,
    beneficiary: p.beneficiary,
    asset: p.asset,
    amount: p.amount,
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

export function rejectPayment(signer: Signer, paymentId: string, reason: string) {
  return write<void>(signer, 'reject_payment', {
    payment_id: BigInt(paymentId),
    caller: signer.publicKey,
    reason,
  })
}

export function reclaimExpired(signer: Signer, paymentId: string) {
  return write<void>(signer, 'reclaim_expired', { payment_id: BigInt(paymentId) })
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
    ivms101Version: '2023',
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

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return bytesToHex(new Uint8Array(digest))
}
