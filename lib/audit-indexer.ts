import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk'
import { mapEvent, AUDIT_BACKFILL_LEDGERS, AUDIT_MAX_PAGES, AUDIT_PAGE_SIZE } from './contract'
import type { AuditEvent } from './types'

export interface AuditIndexerCursor {
  /** Highest fully processed ledger, or highest event ledger during a paged scan. */
  lastLedger: number
  /** RPC pagination token for an incomplete scan. */
  rpcCursor: string | null
}

export interface AuditIndexerStore {
  getCursor(contractId: string): Promise<AuditIndexerCursor>
  savePage(contractId: string, events: AuditEvent[], cursor: AuditIndexerCursor): Promise<void>
}

export interface AuditIndexerBatchResult {
  processedPages: number
  indexedEvents: number
  lastLedger: number
  caughtUp: boolean
}

/** Polls a bounded number of pages, persisting each page before requesting the next. */
export async function indexAuditEventBatch(
  server: Pick<rpc.Server, 'getEvents'>,
  contractId: string,
  latestLedger: number,
  store: AuditIndexerStore,
  maxPages = AUDIT_MAX_PAGES,
): Promise<AuditIndexerBatchResult> {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('maxPages must be a positive integer')
  }

  const filters = [{ type: 'contract' as const, contractIds: [contractId] }]
  let state = await store.getCursor(contractId)
  let rpcCursor = state.rpcCursor
  let startLedger = rpcCursor
    ? undefined
    : state.lastLedger > 0
      ? state.lastLedger + 1
      : Math.max(1, latestLedger - AUDIT_BACKFILL_LEDGERS)
  let processedPages = 0
  let indexedEvents = 0
  let caughtUp = false

  while (processedPages < maxPages) {
    let response: Awaited<ReturnType<typeof server.getEvents>>
    if (rpcCursor) {
      response = await server.getEvents({ cursor: rpcCursor, filters, limit: AUDIT_PAGE_SIZE })
    } else {
      if (startLedger === undefined) throw new Error('Audit indexer is missing its ledger checkpoint')
      response = await server.getEvents({ startLedger, filters, limit: AUDIT_PAGE_SIZE })
    }
    const events = response.events
      .map(event =>
        mapEvent({
          id: event.id,
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
          txHash: event.txHash,
          topics: event.topic.map((topic: xdr.ScVal) => scValToNative(topic)),
          data: scValToNative(event.value),
        }),
      )
      .filter((event): event is AuditEvent => event !== null)
    const pageLastLedger = response.events.reduce((last, event) => Math.max(last, event.ledger), state.lastLedger)
    const hasMore = response.events.length === AUDIT_PAGE_SIZE

    if (hasMore && !response.cursor) {
      throw new Error('Stellar RPC returned a full event page without a pagination cursor')
    }

    state = hasMore
      ? { lastLedger: pageLastLedger, rpcCursor: response.cursor }
      : { lastLedger: Math.max(latestLedger, pageLastLedger), rpcCursor: null }
    await store.savePage(contractId, events, state)

    indexedEvents += events.length
    processedPages += 1
    if (!hasMore) {
      caughtUp = true
      break
    }

    rpcCursor = response.cursor
    startLedger = undefined
  }

  return {
    processedPages,
    indexedEvents,
    lastLedger: state.lastLedger,
    caughtUp,
  }
}
