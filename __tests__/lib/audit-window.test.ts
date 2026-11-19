// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcState = vi.hoisted(() => ({
  latest: 200_000,
  wideFails: false,
  startLedgers: [] as number[],
}))

vi.mock('@/lib/config', async orig => ({ ...(await orig<object>()), isContractConfigured: true }))

vi.mock('@stellar/stellar-sdk', async orig => {
  const actual = await orig<typeof import('@stellar/stellar-sdk')>()
  class FakeServer {
    async getLatestLedger() {
      return { sequence: rpcState.latest }
    }
    async getEvents(req: { startLedger?: number }) {
      if (req.startLedger !== undefined) {
        rpcState.startLedgers.push(req.startLedger)
        const wide = rpcState.latest - req.startLedger > 17_000
        if (wide && rpcState.wideFails) throw new Error('RPC: retention exceeded')
      }
      return { events: [], cursor: '' }
    }
    async getLedgers() {
      return { ledgers: [{ ledgerCloseTime: '1800000000' }] }
    }
  }
  return { ...actual, rpc: { ...actual.rpc, Server: FakeServer } }
})

import { listAuditEvents } from '@/lib/contract'

beforeEach(() => {
  rpcState.wideFails = false
  rpcState.startLedgers = []
})

describe('listAuditEvents window reporting', () => {
  it('reports the wide window and its start date when no fallback was needed', async () => {
    const res = await listAuditEvents()

    expect(rpcState.startLedgers).toEqual([200_000 - 115_000])
    expect(res.window).toEqual({
      startLedger: 85_000,
      latestLedger: 200_000,
      since: 1_800_000_000,
      fallback: false,
      fallbackReason: undefined,
    })
    expect(res.truncated).toBe(false)
  })

  it('uses the narrow window and records the reason when the wide query fails', async () => {
    rpcState.wideFails = true
    const res = await listAuditEvents()

    expect(rpcState.startLedgers).toEqual([200_000 - 115_000, 200_000 - 17_000])
    expect(res.window.startLedger).toBe(183_000)
    expect(res.window.fallback).toBe(true)
    expect(res.window.fallbackReason).toBe('RPC: retention exceeded')
  })
})
