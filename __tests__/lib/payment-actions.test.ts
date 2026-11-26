import { describe, it, expect } from 'vitest'
import { CONTRACT_ERRORS } from '@/lib/errors'
import { rejectBlockReason, releaseBlockReason, type PaymentActionState } from '@/lib/payment-actions'
import { PaymentStatus } from '@/lib/types'

const TO_VASP = 'GBENEFICIARYVASP000000000000000000000000000000000000000'
const ADMIN = 'GADMIN000000000000000000000000000000000000000000000000'
const VIEWER = 'GVIEWER000000000000000000000000000000000000000000000000'

function state(overrides: Partial<PaymentActionState> = {}): PaymentActionState {
  return {
    payment: {
      status: PaymentStatus.Pending,
      toVasp: TO_VASP,
      expiresAt: 1_000,
      requiresAttestation: false,
      attestationHash: 'ab'.repeat(32),
    },
    address: TO_VASP,
    admin: ADMIN,
    now: 500,
    receivingVaspActive: true,
    received: { status: 'match', computedHash: 'ab'.repeat(32) },
    override: false,
    ...overrides,
  }
}

describe('releaseBlockReason', () => {
  it('allows the receiving VASP to release a verified, unexpired payment', () => {
    expect(releaseBlockReason(state())).toBeNull()
  })

  it('uses the contract reason when an attestation is still required', () => {
    const reason = releaseBlockReason(
      state({
        payment: {
          ...state().payment,
          requiresAttestation: true,
          attestationHash: undefined,
        },
      }),
    )
    expect(reason).toBe(CONTRACT_ERRORS[9])
  })

  it('uses the contract reason once the payment has expired', () => {
    expect(releaseBlockReason(state({ now: 1_000 }))).toBe(CONTRACT_ERRORS[36])
  })

  it('explains that only the beneficiary VASP or admin may release', () => {
    expect(releaseBlockReason(state({ address: VIEWER }))).toBe(CONTRACT_ERRORS[11])
  })

  it('blocks release when the receiving VASP is no longer active', () => {
    expect(releaseBlockReason(state({ receivingVaspActive: false }))).toBe(CONTRACT_ERRORS[5])
  })

  it('distinguishes an unverified payload from a mismatched one', () => {
    expect(releaseBlockReason(state({ received: null }))).toMatch(/Paste and verify/)
    expect(releaseBlockReason(state({ received: { status: 'mismatch', computedHash: 'cd'.repeat(32) } }))).toMatch(
      /does not match/,
    )
    expect(releaseBlockReason(state({ received: { status: 'invalid', error: 'Not valid JSON' } }))).toMatch(
      /Not valid JSON/,
    )
  })

  it('allows an explicit override when no payload was verified', () => {
    expect(releaseBlockReason(state({ received: null, override: true }))).toBeNull()
  })

  it('asks a disconnected user to connect instead of hiding the action', () => {
    expect(releaseBlockReason(state({ address: undefined }))).toMatch(/Connect your wallet/)
  })
})

describe('rejectBlockReason', () => {
  it('requires a non-blank reason', () => {
    expect(rejectBlockReason(state(), '   ')).toMatch(/Enter a reason/)
    expect(rejectBlockReason(state(), 'Counterparty sanctions hit')).toBeNull()
  })

  it('uses the contract reason for an oversized reason', () => {
    expect(rejectBlockReason(state(), 'x'.repeat(257))).toBe(CONTRACT_ERRORS[17])
  })

  it('keeps rejection available after expiry, matching the contract', () => {
    expect(rejectBlockReason(state({ now: 2_000 }), 'Payment cannot be completed')).toBeNull()
  })

  it('explains the permission requirement to a non-party wallet', () => {
    expect(rejectBlockReason(state({ address: VIEWER }), 'reason')).toBe(CONTRACT_ERRORS[11])
  })

  it('reports an already resolved payment', () => {
    const resolved = state({ payment: { ...state().payment, status: PaymentStatus.Released } })
    expect(rejectBlockReason(resolved, 'reason')).toBe(CONTRACT_ERRORS[8])
    expect(releaseBlockReason(resolved)).toBe(CONTRACT_ERRORS[8])
  })
})
