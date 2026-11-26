import { createClient } from '@libsql/client'
import type { Client, InValue, Row } from '@libsql/client'
import type { AuditIndexerCursor, AuditIndexerStore } from './audit-indexer'
import type { AuditEvent, AuditEventType } from './types'

let client: Client | undefined

function getClient(): Client {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url || !authToken) {
    throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured')
  }
  client ??= createClient({ url, authToken })
  return client
}

async function ensureSchema(db: Client): Promise<void> {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS audit_events (
        contract_id TEXT NOT NULL,
        id TEXT NOT NULL,
        ledger INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        details TEXT NOT NULL,
        PRIMARY KEY (contract_id, id)
      )`,
      `CREATE INDEX IF NOT EXISTS audit_events_contract_order
        ON audit_events (contract_id, ledger DESC, timestamp DESC, id DESC)`,
      `CREATE TABLE IF NOT EXISTS audit_indexer_state (
        contract_id TEXT PRIMARY KEY,
        last_ledger INTEGER NOT NULL,
        rpc_cursor TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS audit_indexer_locks (
        contract_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        locked_until INTEGER NOT NULL
      )`,
    ],
    'write',
  )
}

function parseDetails(value: unknown): Record<string, string> {
  if (typeof value !== 'string') throw new Error('Stored audit event details are not valid JSON')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Stored audit event details are not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Stored audit event details must be an object')
  }
  const entries = Object.entries(parsed)
  if (entries.some(([, item]) => typeof item !== 'string')) {
    throw new Error('Stored audit event details must contain only string values')
  }
  return Object.fromEntries(entries) as Record<string, string>
}

function toAuditEvent(row: Row): AuditEvent {
  const type = row.type
  if (typeof type !== 'string') throw new Error('Stored audit event type is invalid')
  return {
    id: String(row.id),
    ledger: Number(row.ledger),
    timestamp: Number(row.timestamp),
    txHash: String(row.tx_hash),
    type: type as AuditEventType,
    subject: String(row.subject),
    description: String(row.description),
    details: parseDetails(row.details),
  }
}

export function createAuditStore(getDb: () => Client): AuditIndexerStore & {
  listEvents(contractId: string): Promise<AuditEvent[]>
  acquireLock(contractId: string, owner: string): Promise<boolean>
  releaseLock(contractId: string, owner: string): Promise<void>
} {
  return {
    async getCursor(contractId) {
      const db = getDb()
      await ensureSchema(db)
      const result = await db.execute({
        sql: 'SELECT last_ledger, rpc_cursor FROM audit_indexer_state WHERE contract_id = ?',
        args: [contractId],
      })
      const row = result.rows[0]
      return row
        ? { lastLedger: Number(row.last_ledger), rpcCursor: row.rpc_cursor == null ? null : String(row.rpc_cursor) }
        : { lastLedger: 0, rpcCursor: null }
    },

    async savePage(contractId, events, cursor) {
      const db = getDb()
      await ensureSchema(db)
      const statements = events.map(event => ({
        sql: `INSERT INTO audit_events
          (contract_id, id, ledger, timestamp, tx_hash, type, subject, description, details)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(contract_id, id) DO NOTHING`,
        args: [
          contractId,
          event.id,
          event.ledger,
          event.timestamp,
          event.txHash,
          event.type,
          event.subject,
          event.description,
          JSON.stringify(event.details ?? {}),
        ] as InValue[],
      }))
      statements.push({
        sql: `INSERT INTO audit_indexer_state (contract_id, last_ledger, rpc_cursor)
          VALUES (?, ?, ?)
          ON CONFLICT(contract_id) DO UPDATE SET
            last_ledger = excluded.last_ledger,
            rpc_cursor = excluded.rpc_cursor`,
        args: [contractId, cursor.lastLedger, cursor.rpcCursor],
      })
      await db.batch(statements, 'write')
    },

    async listEvents(contractId) {
      const db = getDb()
      await ensureSchema(db)
      const result = await db.execute({
        sql: `SELECT id, ledger, timestamp, tx_hash, type, subject, description, details
          FROM audit_events WHERE contract_id = ?
          ORDER BY ledger DESC, timestamp DESC, id DESC`,
        args: [contractId],
      })
      return result.rows.map(toAuditEvent)
    },

    async acquireLock(contractId, owner) {
      const db = getDb()
      await ensureSchema(db)
      const now = Date.now()
      const result = await db.execute({
        sql: `INSERT INTO audit_indexer_locks (contract_id, owner, locked_until)
          VALUES (?, ?, ?)
          ON CONFLICT(contract_id) DO UPDATE SET
            owner = excluded.owner,
            locked_until = excluded.locked_until
          WHERE audit_indexer_locks.locked_until <= ?`,
        args: [contractId, owner, now + 5 * 60_000, now],
      })
      return result.rowsAffected === 1
    },

    async releaseLock(contractId, owner) {
      const db = getDb()
      await ensureSchema(db)
      await db.execute({
        sql: 'UPDATE audit_indexer_locks SET locked_until = 0 WHERE contract_id = ? AND owner = ?',
        args: [contractId, owner],
      })
    },
  }
}

export const auditStore = createAuditStore(getClient)
