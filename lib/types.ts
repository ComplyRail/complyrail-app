// App-side view of the ComplyRail contract types (contracts/complyrail/src/lib.rs).

export enum VaspStatus {
  Active = 'active',
  Suspended = 'suspended',
  Revoked = 'revoked',
}

export enum PaymentStatus {
  Pending = 'pending',
  Released = 'released',
  Rejected = 'rejected',
  Reclaimed = 'reclaimed',
}

export interface VaspEntry {
  address: string
  name: string
  jurisdiction: string
  /** hex-encoded 32-byte key used off-chain to encrypt IVMS101 payloads */
  publicKey: string
  status: VaspStatus
  addedAt: number
  expiresAt?: number
}

export interface PaymentRecord {
  id: string
  fromVasp: string
  toVasp: string
  beneficiary: string
  /** Stellar Asset Contract address */
  asset: string
  /** integer units (stroops) as a decimal string */
  amount: string
  status: PaymentStatus
  requiresAttestation: boolean
  attestationHash?: string
  ivmsVersion?: string
  attestedAt?: number
  createdAt: number
  expiresAt: number
  resolvedAt?: number
}

export type AuditEventType =
  | 'vasp_reg'
  | 'vasp_upd'
  | 'thr_set'
  | 'pay_sub'
  | 'att_sub'
  | 'pay_rel'
  | 'pay_rej'

export interface AuditEvent {
  id: string
  ledger: number
  timestamp: number
  txHash: string
  type: AuditEventType
  /** subject of the event: VASP / asset address, or payment id */
  subject: string
  description: string
  details?: Record<string, string>
}

export interface ThresholdRow {
  asset: string
  jurisdiction: string
  /** integer units */
  amount: bigint
}
