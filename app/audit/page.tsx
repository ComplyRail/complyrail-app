'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuditEvents } from '@/lib/hooks'
import { formatAddress, isStellarAddressOrHash } from '@/lib/format'
import { ExplorerLink } from '@/components/Notice'
import { ResponsiveTable } from '@/components/ResponsiveTable'

const EVENT_TYPES = [
  { value: 'vasp_reg', label: 'VASP Registration' },
  { value: 'vasp_upd', label: 'VASP Update' },
  { value: 'thr_set', label: 'Threshold Set' },
  { value: 'admin_chg', label: 'Admin Changed' },
  { value: 'adm_prop', label: 'Admin Proposed' },
  { value: 'adm_acc', label: 'Admin Accepted' },
  { value: 'pay_sub', label: 'Payment Submitted' },
  { value: 'att_sub', label: 'Attestation Submitted' },
  { value: 'pay_rel', label: 'Payment Released' },
  { value: 'pay_rej', label: 'Payment Rejected' },
  { value: 'pay_recl', label: 'Payment Reclaimed' },
]

function dayStartMs(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const t = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  return Number.isFinite(t) ? t : null
}

function dayEndMs(yyyyMmDd: string): number | null {
  const start = dayStartMs(yyyyMmDd)
  return start === null ? null : start + 24 * 60 * 60 * 1000 - 1
}

export default function AuditLogPage() {
  const { events, truncated, window: auditWindow, loading, error, reload } = useAuditEvents()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const selectedTypes = searchParams.getAll('type')
  const query = searchParams.get('q') || ''
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const handleTypeChange = (type: string) => {
    updateParams(params => {
      const types = new Set(params.getAll('type'))
      if (types.has(type)) types.delete(type)
      else types.add(type)
      params.delete('type')
      for (const t of EVENT_TYPES.map(e => e.value)) {
        if (types.has(t)) params.append('type', t)
      }
    })
  }

  const needle = query.trim().toLowerCase()
  const fromMs = from ? dayStartMs(from) : null
  const toMs = to ? dayEndMs(to) : null

  const filteredEvents = events.filter(e => {
    if (selectedTypes.length > 0 && !selectedTypes.includes(e.type)) return false
    const tsMs = e.timestamp * 1000
    if (fromMs !== null && tsMs < fromMs) return false
    if (toMs !== null && tsMs > toMs) return false
    if (needle) {
      const hay = `${e.subject} ${e.txHash}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })

  const exportCSV = () => {
    const escapeCsvCell = (cell: string): string => {
      // Neutralise formula injection: cells starting with =, +, -, @ are prefixed with '.
      const safe = /^[=+\-@]/.test(cell) ? `'${cell}` : cell
      // Escape embedded double-quotes by doubling them, then wrap in quotes.
      return `"${safe.replace(/"/g, '""')}"`
    }
    const csv = [
      ['ID', 'Timestamp', 'Ledger', 'Tx hash', 'Type', 'Subject', 'Description', 'Details'],
      ...filteredEvents.map(e => [
        e.id,
        new Date(e.timestamp * 1000).toISOString(),
        String(e.ledger),
        e.txHash,
        e.type,
        e.subject,
        e.description,
        JSON.stringify(e.details ?? {}),
      ]),
    ]
    const csvContent = csv.map(row => row.map(cell => escapeCsvCell(cell)).join(',')).join('\n')
    triggerDownload(new Blob([csvContent], { type: 'text/csv' }), `audit-log-${Date.now()}.csv`)
  }

  const exportJSON = () => {
    const json = JSON.stringify(filteredEvents, null, 2)
    triggerDownload(new Blob([json], { type: 'application/json' }), `audit-log-${Date.now()}.json`)
  }

  /** Create a temporary object URL, trigger a download, then immediately revoke. */
  function triggerDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Audit Log</h1>
          <div className="text-center text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Audit Log</h1>
          <div className="text-center text-red-600">Error: {error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Audit Log</h1>
          <p className="text-muted-foreground">
            Live contract events from Stellar RPC (about the last 7 days).{' '}
            <button onClick={reload} className="text-primary hover:underline">Refresh</button>
          </p>
          {auditWindow.since > 0 && (
            <p className="text-sm text-muted-foreground mt-2" data-testid="audit-window">
              Showing events since {new Date(auditWindow.since * 1000).toLocaleString()}
              {auditWindow.fallback && ' (reduced window: the full 7-day query failed)'}
            </p>
          )}
        </div>

        {truncated && (
          <div role="status" className="mb-8 rounded-lg border border-yellow-500 bg-yellow-50 p-4 text-sm text-yellow-900">
            Showing the newest {events.length} events. The log has more events in this window that were not loaded.
          </div>
        )}

        <div className="mb-8 bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">From date</span>
              <input
                type="date"
                value={from}
                onChange={e => updateParams(p => { if (e.target.value) p.set('from', e.target.value); else p.delete('from') })}
                className="px-3 py-2 border border-border rounded bg-background"
                aria-label="From date"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">To date</span>
              <input
                type="date"
                value={to}
                onChange={e => updateParams(p => { if (e.target.value) p.set('to', e.target.value); else p.delete('to') })}
                className="px-3 py-2 border border-border rounded bg-background"
                aria-label="To date"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Search subject or tx hash</span>
              <input
                type="search"
                value={query}
                onChange={e => updateParams(p => { if (e.target.value) p.set('q', e.target.value); else p.delete('q') })}
                placeholder="Subject or transaction hash"
                className="px-3 py-2 border border-border rounded bg-background"
                aria-label="Search subject or transaction hash"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {EVENT_TYPES.map(et => (
              <label key={et.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(et.value)}
                  onChange={() => handleTypeChange(et.value)}
                  className="w-4 h-4"
                />
                <span className="text-sm">{et.label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportCSV}
              className="px-4 py-2 rounded bg-secondary text-secondary-foreground hover:opacity-90"
            >
              Export CSV
            </button>
            <button
              onClick={exportJSON}
              className="px-4 py-2 rounded bg-secondary text-secondary-foreground hover:opacity-90"
            >
              Export JSON
            </button>
          </div>
        </div>

        <ResponsiveTable
          rows={filteredEvents}
          rowKey={event => event.id}
          columns={[
            { header: 'Timestamp', className: 'text-sm', cell: event => new Date(event.timestamp * 1000).toLocaleString() },
            { header: 'Type', className: 'text-sm', cell: event => (
              <span className="inline-block px-2 py-1 rounded bg-muted text-xs font-mono">{event.type}</span>
            ) },
            { header: 'Subject', className: 'text-sm font-mono', cell: event =>
              /^\d+$/.test(event.subject) ? `#${event.subject}` : formatAddress(event.subject) },
            { header: 'Description', className: 'text-sm', cell: event => (
              <>
                {event.description}
                {event.details && Object.keys(event.details).length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {Object.entries(event.details).map(([k, v]) => `${k}: ${isStellarAddressOrHash(v) ? formatAddress(v) : v}`).join(' · ')}
                  </div>
                )}
              </>
            ) },
            { header: 'Tx', className: 'text-sm font-mono', cell: event => (
              <ExplorerLink kind="tx" id={event.txHash}>{event.txHash.slice(0, 8)}</ExplorerLink>
            ) },
          ]}
        />

        {filteredEvents.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No audit events found
          </div>
        )}
      </div>
    </div>
  )
}
