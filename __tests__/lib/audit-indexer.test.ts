// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { xdr } from '@stellar/stellar-sdk'
import { indexAuditEventBatch } from '@/lib/audit-indexer'
import type { AuditIndexerCursor } from '@/lib/audit-indexer'

type Request = { startLedger?: number; cursor?: string }

function rpcEvent(id: string, ledger: number) {
  return {
    id,
    ledger,
    ledgerClosedAt: '2026-01-01T00:00:00Z',
    txHash: 'tx-hash',
    topic: [xdr.ScVal.scvSymbol('unknown_event')],
    value: xdr.ScVal.scvVoid(),
  }
}

function fakeServer(pages: Array<{ events: ReturnType<typeof rpcEvent>[]; cursor: string }>) {
  const requests: Request[] = []
  const getEvents = vi.fn(async (request: Request) => {
    requests.push(request)
    const page = pages.shift()
    if (!page) throw new Error('Unexpected RPC request')
    return page
  })
  return { server: { getEvents } as never, requests }
}

describe('indexAuditEventBatch cursor checkpoints', () => {
  it('resumes a partial scan by RPC cursor and then starts after the completed ledger', async () => {
    let cursor: AuditIndexerCursor = { lastLedger: 0, rpcCursor: null }
    const store = {
      getCursor: vi.fn(async () => cursor),
      savePage: vi.fn(async (_contractId: string, _events: unknown[], next: AuditIndexerCursor) => {
        cursor = next
      }),
    }
    const { server, requests } = fakeServer([
      { events: Array.from({ length: 1000 }, (_, i) => rpcEvent(`first-${i}`, 190_000)), cursor: 'resume-here' },
      { events: [rpcEvent('last', 190_001)], cursor: 'finished' },
      { events: [], cursor: 'next-ledger' },
    ])

    const first = await indexAuditEventBatch(server, 'CONTRACT', 200_000, store, 1)
    expect(first).toMatchObject({ processedPages: 1, caughtUp: false, lastLedger: 190_000 })
    expect(requests[0]).toMatchObject({ startLedger: 85_000 })
    expect(cursor).toEqual({ lastLedger: 190_000, rpcCursor: 'resume-here' })

    const second = await indexAuditEventBatch(server, 'CONTRACT', 200_100, store)
    expect(second).toMatchObject({ processedPages: 1, caughtUp: true, lastLedger: 200_100 })
    expect(requests[1]).toMatchObject({ cursor: 'resume-here' })
    expect(requests[1].startLedger).toBeUndefined()
    expect(cursor).toEqual({ lastLedger: 200_100, rpcCursor: null })

    await indexAuditEventBatch(server, 'CONTRACT', 200_101, store)
    expect(requests[2]).toMatchObject({ startLedger: 200_101 })
    expect(requests[2].cursor).toBeUndefined()
  })

  it('rejects invalid page limits rather than silently skipping indexing', async () => {
    const store = { getCursor: vi.fn(), savePage: vi.fn() }
    await expect(indexAuditEventBatch({} as never, 'CONTRACT', 1, store, 0)).rejects.toThrow(
      'maxPages must be a positive integer',
    )
    expect(store.getCursor).not.toHaveBeenCalled()
  })
})
