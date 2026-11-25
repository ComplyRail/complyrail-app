'use client'

import { useState } from 'react'
import { useAuditEvents } from '@/lib/hooks'
import { formatAddress } from '@/lib/format'
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

export default function AuditLogPage() {
  const { events, truncated, window: auditWindow, loading, error, reload } = useAuditEvents()
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  const filteredEvents = selectedTypes.length > 0
    ? events.filter(e => selectedTypes.includes(e.type))
    : events

  const handleTypeChange = (type: string) => {
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    )
  }

  const exportCSV = () => {
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
        JSON.stringify(e.details ?? {}).replace(/"/g, "'"),
      ]),
    ]
    const csvContent = csv.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${Date.now()}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const exportJSON = () => {
    const json = JSON.stringify(filteredEvents, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${Date.now()}.json`
    a.click()
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
            Permanent indexed contract events, with Stellar RPC fallback when the index is empty.{' '}
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
                    {Object.entries(event.details).map(([k, v]) => `${k}: ${v.length > 20 ? formatAddress(v) : v}`).join(' · ')}
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
