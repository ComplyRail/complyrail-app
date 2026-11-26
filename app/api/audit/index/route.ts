import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { rpc } from '@stellar/stellar-sdk'
import { config, isContractConfigured } from '@/lib/config'
import { auditStore } from '@/lib/audit-store'
import { indexAuditEventBatch } from '@/lib/audit-indexer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: Request, secret: string): boolean {
  const value = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const actualBytes = Buffer.from(value)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET must be configured' }, { status: 500 })
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isContractConfigured) {
    return NextResponse.json({ error: 'The ComplyRail contract is not configured' }, { status: 503 })
  }

  const owner = randomUUID()
  try {
    const acquired = await auditStore.acquireLock(config.contractId, owner)
    if (!acquired) {
      return NextResponse.json({ error: 'An audit indexing run is already in progress' }, { status: 409 })
    }
    try {
      const server = new rpc.Server(config.rpcUrl)
      const latest = (await server.getLatestLedger()).sequence
      const result = await indexAuditEventBatch(
        server,
        config.contractId,
        latest,
        auditStore,
      )
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } finally {
      await auditStore.releaseLock(config.contractId, owner)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
