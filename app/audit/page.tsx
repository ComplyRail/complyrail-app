'use client'

import { useState } from 'react'
import { useAuditEvents } from '@/lib/hooks'
import { formatAddress } from '@/lib/mockData'

const EVENT_TYPES = [
  { value: 'vasp_reg', label: 'VASP Registration' },
  { value: 'vasp_upd', label: 'VASP Update' },
  { value: 'thr_set', label: 'Threshold Set' },
  { value: 'pay_sub', label: 'Payment Submitted' },
  { value: 'att_sub', label: 'Attestation Submitted' },
  { value: 'pay_rel', label: 'Payment Released' },
  { value: 'pay_rej', label: 'Payment Rejected' },
]

export default function AuditLogPage() {
  const { events, loading, error } = useAuditEvents()
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
      ['ID', 'Timestamp', 'Type', 'Actor', 'Description'],
      ...filteredEvents.map(e => [
        e.id,
        new Date(e.timestamp * 1000).toISOString(),
        e.type,
        e.actor,
        e.description,
      ]),
    ]
    const csvContent = csv.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${Date.now()}.csv`
    a.click()
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
          <p className="text-muted-foreground">Contract events and compliance history</p>
        </div>

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

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold">Timestamp</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Type</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Actor</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={event.id} className="border-b border-border hover:bg-muted/50">
                    <td className="px-6 py-4 text-sm">
                      {new Date(event.timestamp * 1000).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="inline-block px-2 py-1 rounded bg-muted text-xs font-mono">
                        {event.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono">{formatAddress(event.actor)}</td>
                    <td className="px-6 py-4 text-sm">{event.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {filteredEvents.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No audit events found
          </div>
        )}
      </div>
    </div>
  )
}
