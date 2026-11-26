// @vitest-environment node
import { createClient } from '@libsql/client'
import { describe, expect, it } from 'vitest'
import { createAuditStore } from '@/lib/audit-store'
import type { AuditEvent } from '@/lib/types'

describe('auditStore', () => {
  it('deduplicates event IDs while atomically advancing the ledger cursor', async () => {
    const db = createClient({ url: 'file::memory:' })
    const store = createAuditStore(() => db)
    const event: AuditEvent = {
      id: 'contract-event-id',
      ledger: 120,
      timestamp: 1_800_000_000,
      txHash: 'transaction-hash',
      type: 'vasp_reg',
      subject: 'GABC',
      description: 'VASP registered',
      details: { name: 'Example VASP' },
    }

    try {
      await store.savePage('CONTRACT', [event], { lastLedger: 120, rpcCursor: 'page-2' })
      await store.savePage('CONTRACT', [event], { lastLedger: 130, rpcCursor: null })

      expect(await store.listEvents('CONTRACT')).toEqual([event])
      expect(await store.getCursor('CONTRACT')).toEqual({ lastLedger: 130, rpcCursor: null })
    } finally {
      await db.close()
    }
  })

  it('allows only one active indexer lock per contract', async () => {
    const db = createClient({ url: 'file::memory:' })
    const store = createAuditStore(() => db)

    try {
      expect(await store.acquireLock('CONTRACT', 'first')).toBe(true)
      expect(await store.acquireLock('CONTRACT', 'second')).toBe(false)
      await store.releaseLock('CONTRACT', 'first')
      expect(await store.acquireLock('CONTRACT', 'second')).toBe(true)
    } finally {
      await db.close()
    }
  })
})
