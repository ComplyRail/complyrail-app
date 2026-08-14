'use client'

import { useVasps } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { formatAddress } from '@/lib/mockData'
import { useState } from 'react'

export default function VaspsPage() {
  const { vasps, loading, error } = useVasps()

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">VASP Directory</h1>
          <div className="text-center text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">VASP Directory</h1>
          <div className="text-center text-red-600">Error: {error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">VASP Directory</h1>
          <p className="text-muted-foreground">Registered Virtual Asset Service Providers</p>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold">Name</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Address</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Jurisdiction</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Expires</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vasps.map((vasp) => {
                  const isExpired = vasp.expiresAt && Date.now() / 1000 > vasp.expiresAt
                  const expiresIn = vasp.expiresAt ? Math.ceil((vasp.expiresAt - Date.now() / 1000) / 86400) : null
                  return (
                    <tr key={vasp.address} className={`border-b border-border hover:bg-muted/50 ${isExpired ? 'bg-red-50' : ''}`}>
                      <td className="px-6 py-4 font-medium">{vasp.name}</td>
                      <td className="px-6 py-4 font-mono text-sm">{formatAddress(vasp.address)}</td>
                      <td className="px-6 py-4">{vasp.jurisdiction}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={vasp.status} type="vasp" />
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {vasp.expiresAt ? (
                          <span className={isExpired ? 'text-red-600 font-semibold' : 'text-muted-foreground'}>
                            {isExpired ? 'Expired' : expiresIn ? `${expiresIn}d remaining` : 'N/A'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No expiry</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs hover:opacity-90"
                          onClick={() => alert(`Renew registration for ${vasp.name}`)}
                        >
                          Renew
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {vasps.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No VASPs registered yet
          </div>
        )}
      </div>
    </div>
  )
}
