// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake contract client: counts every RPC call and tracks the peak number in flight.
const state = vi.hoisted(() => ({
  calls: [] as string[],
  inFlight: 0,
  maxInFlight: 0,
  vaspAddresses: [] as string[],
  paymentCount: 0n,
}))

vi.mock('@/lib/config', async orig => ({ ...(await orig<object>()), isContractConfigured: true }))

vi.mock('@stellar/stellar-sdk', async orig => {
  const actual = await orig<typeof import('@stellar/stellar-sdk')>()
  const fakeClient = {
    async list_vasps() {
      state.calls.push('list_vasps')
      return { result: state.vaspAddresses }
    },
    async get_vasp({ address }: { address: string }) {
      return track('get_vasp', () => ({
        result: {
          address,
          name: 'Acme',
          jurisdiction: 'US',
          public_key: new Uint8Array(32),
          status: { tag: 'Active' },
          added_at: 1n,
          expires_at: null,
        },
      }))
    },
    async payment_count() {
      state.calls.push('payment_count')
      return { result: state.paymentCount }
    },
    async get_payment({ payment_id }: { payment_id: bigint }) {
      return track('get_payment', () => ({
        result: {
          id: payment_id,
          from_vasp: 'G1',
          to_vasp: 'G2',
          beneficiary: 'G2',
          asset: 'C1',
          amount: 1n,
          status: { tag: 'Pending' },
          requires_attestation: false,
          created_at: 1n,
          expires_at: 2n,
        },
      }))
    },
  }
  // Each read is one simulated RPC round trip that resolves on the next macrotask.
  async function track<T>(name: string, make: () => T): Promise<T> {
    state.calls.push(name)
    state.inFlight++
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
    await new Promise(r => setTimeout(r, 1))
    state.inFlight--
    return make()
  }
  return { ...actual, contract: { ...actual.contract, Client: { from: async () => fakeClient } } }
})

import { listPayments, listVasps, RPC_CONCURRENCY } from '@/lib/contract'

beforeEach(() => {
  state.calls = []
  state.inFlight = 0
  state.maxInFlight = 0
})

describe('RPC read batching', () => {
  it('listVasps makes one list call plus one get per VASP, never more than RPC_CONCURRENCY at once', async () => {
    state.vaspAddresses = Array.from({ length: 12 }, (_, i) => `G${i}`)
    const vasps = await listVasps()

    expect(vasps).toHaveLength(12)
    expect(state.calls.filter(c => c === 'list_vasps')).toHaveLength(1)
    expect(state.calls.filter(c => c === 'get_vasp')).toHaveLength(12)
    expect(state.maxInFlight).toBeLessThanOrEqual(RPC_CONCURRENCY)
    expect(state.maxInFlight).toBeGreaterThan(1)
  })

  it('listPayments fetches exactly one page of the requested size', async () => {
    state.paymentCount = 20n
    const payments = await listPayments(7)

    expect(payments.map(p => p.id)).toEqual(['19', '18', '17', '16', '15', '14', '13'])
    expect(state.calls.filter(c => c === 'payment_count')).toHaveLength(1)
    expect(state.calls.filter(c => c === 'get_payment')).toHaveLength(7)
    expect(state.maxInFlight).toBeLessThanOrEqual(RPC_CONCURRENCY)
  })
})
