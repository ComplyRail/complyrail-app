// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { friendlyError } from '@/lib/errors'

// Each case is a raw failure string in the shape the Stellar SDK / Horizon / Soroban RPC
// surfaces it, paired with the message a user should see.
describe('friendlyError', () => {
  it('maps a simulation underfunded result to an insufficient-balance message', () => {
    const raw = new Error('Transaction failed: { "result_codes": { "operations": ["op_underfunded"] } }')
    expect(friendlyError(raw)).toMatch(/^Insufficient balance/)
  })

  it('tells the user to add a trustline when the asset has none', () => {
    const raw = new Error('Transaction failed: { "operations": ["op_no_trust"] }')
    expect(friendlyError(raw)).toContain('Add the trustline')
  })

  it('suggests Friendbot when the source account does not exist on testnet', () => {
    const raw = new Error('Horizon error: Account not found (404)')
    expect(friendlyError(raw)).toContain('Fund it with Friendbot')
  })

  it('suggests Friendbot when the destination account does not exist', () => {
    const raw = new Error('Transaction failed: { "operations": ["op_no_destination"] }')
    expect(friendlyError(raw)).toContain('destination account')
    expect(friendlyError(raw)).toContain('Friendbot')
  })

  it('explains an expired transaction and asks for a retry', () => {
    const raw = new Error('Transaction failed: tx_too_late')
    expect(friendlyError(raw)).toContain('expired before it was submitted')
  })

  it('explains a stale sequence number', () => {
    const raw = new Error('Transaction failed: tx_bad_seq')
    expect(friendlyError(raw)).toContain('sequence number is out of date')
  })

  it('explains a full trustline on the receiving side', () => {
    const raw = new Error('Transaction failed: op_line_full')
    expect(friendlyError(raw)).toContain('trustline limit is full')
  })

  it('maps wallet cancellation', () => {
    expect(friendlyError(new Error('User declined access'))).toBe('Request cancelled in wallet')
  })

  it('prefers a contract error code over a generic pattern in the same message', () => {
    const raw = new Error('HostError: Error(Contract, #12) op_underfunded')
    expect(friendlyError(raw)).toBe('This payment has not expired yet')
  })

  it('leaves unknown errors readable and truncates very long ones', () => {
    expect(friendlyError(new Error('something odd'))).toBe('something odd')
    expect(friendlyError(new Error('x'.repeat(500))).length).toBe(301)
    expect(friendlyError('plain string')).toBe('plain string')
  })
})
