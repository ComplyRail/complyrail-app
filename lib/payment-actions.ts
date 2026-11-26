import { CONTRACT_ERRORS } from './errors'
import type { PayloadCheck } from './ivms'
import { FIELD_LIMITS, lengthError } from './limits'
import { PaymentStatus, type PaymentRecord } from './types'

/**
 * Why a payment action cannot be used, or `null` when it can. Kept pure so the
 * dashboard and its tests agree on the exact wording, and so every reason can
 * be traced back to the contract rule (see lib/errors.ts) that would reject
 * the transaction anyway.
 */
export type BlockReason = string | null

export interface PaymentActionState {
  payment: Pick<PaymentRecord, 'status' | 'expiresAt' | 'toVasp' | 'requiresAttestation' | 'attestationHash'>
  /** Connected wallet, if any. */
  address?: string
  /** Current on-chain admin. */
  admin: string | null
  /** Unix seconds from the ledger clock. */
  now: number
  /** False when the receiving VASP has been suspended, revoked or has expired. */
  receivingVaspActive: boolean
  /** Result of checking the pasted IVMS101 payload, when there is one. */
  received: PayloadCheck | null
  /** The user confirmed they want to release without a matching payload. */
  override: boolean
}

export function releaseBlockReason(state: PaymentActionState): BlockReason {
  const { payment, address, admin, now, receivingVaspActive, received, override } = state
  if (payment.status !== PaymentStatus.Pending) return CONTRACT_ERRORS[8]
  if (!address) return 'Connect your wallet to release this payment.'
  if (address !== payment.toVasp && address !== admin) return CONTRACT_ERRORS[11]
  if (now >= payment.expiresAt) return CONTRACT_ERRORS[36]
  if (!receivingVaspActive) return CONTRACT_ERRORS[5]
  if (payment.requiresAttestation && !payment.attestationHash) return CONTRACT_ERRORS[9]
  if (received?.status === 'invalid') return `The received payload is not valid: ${received.error}.`
  if (received?.status === 'mismatch') return 'The received payload does not match the on-chain attestation hash.'
  if (received?.status !== 'match' && !override) {
    return 'Paste and verify the IVMS101 payload, or confirm the override, before releasing.'
  }
  return null
}

export function rejectBlockReason(state: PaymentActionState, reason: string): BlockReason {
  const { payment, address, admin } = state
  if (payment.status !== PaymentStatus.Pending) return CONTRACT_ERRORS[8]
  if (!address) return 'Connect your wallet to reject this payment.'
  if (address !== payment.toVasp && address !== admin) return CONTRACT_ERRORS[11]
  if (!reason.trim()) return 'Enter a reason before rejecting this payment.'
  if (lengthError('Reason', reason, FIELD_LIMITS.reason)) return CONTRACT_ERRORS[17]
  return null
}
