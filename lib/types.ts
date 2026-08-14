// Local type definitions (mirror of complyrail-sdk types)

export enum VaspStatus {
  Active = 'active',
  Suspended = 'suspended',
  Revoked = 'revoked',
}

export enum PaymentStatus {
  Pending = 'pending',
  Released = 'released',
  Rejected = 'rejected',
  Held = 'held',
}

export interface VaspEntry {
  address: string
  name: string
  jurisdiction: string
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
  asset: string
  amount: string
  status: PaymentStatus
  attestationHash?: string
  ivmsVersion?: string
  createdAt: number
  resolvedAt?: number
}

export interface AuditEvent {
  id: string
  timestamp: number
  type: 'vasp_reg' | 'vasp_upd' | 'thr_set' | 'pay_sub' | 'att_sub' | 'pay_rel' | 'pay_rej'
  actor: string
  description: string
  details?: Record<string, string>
}
