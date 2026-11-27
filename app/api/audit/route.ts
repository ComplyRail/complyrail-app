import { NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { listAuditEvents } from '@/lib/contract'
import { auditStore } from '@/lib/audit-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const events = await auditStore.listEvents(config.contractId)
    if (events.length > 0) {
      const oldest = events[events.length - 1]
      return NextResponse.json(
        {
          events,
          truncated: false,
          window: {
            startLedger: oldest.ledger,
            latestLedger: events[0].ledger,
            since: oldest.timestamp,
            fallback: false,
          },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(await listAuditEvents(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
