'use client'

import { useState } from 'react'
import { useRole, useVasps } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { ExplorerLink, TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { formatAddress } from '@/lib/format'
import { JURISDICTIONS } from '@/lib/config'
import { isValidStellarAddress } from '@/lib/wallet'
import { registerVasp, setVaspStatus } from '@/lib/contract'
import { VaspStatus } from '@/lib/types'

const emptyForm = { address: '', name: '', jurisdiction: '', publicKeyHex: '', expiresDays: '' }

export default function VaspsPage() {
  const { vasps, loading, error, reload } = useVasps()
  const { address } = useWallet()
  const { role } = useRole(address)
  const tx = useTx()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const isAdmin = role === 'admin'

  const formError =
    form.address && !isValidStellarAddress(form.address)
      ? 'Address must be a Stellar public key (G…)'
      : form.publicKeyHex && !/^[0-9a-fA-F]{64}$/.test(form.publicKeyHex)
        ? 'Encryption key must be 32 bytes as 64 hex characters'
        : null

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formError) return
    const expiresAt = form.expiresDays ? Math.floor(Date.now() / 1000) + Number(form.expiresDays) * 86400 : undefined
    const ok = await tx.run(`Registered ${form.name}`, s =>
      registerVasp(s, { ...form, publicKeyHex: form.publicKeyHex.toLowerCase(), expiresAt }).then(() => true),
    )
    if (ok) {
      setForm(emptyForm)
      setShowForm(false)
      reload()
    }
  }

  const changeStatus = async (vaspAddress: string, status: VaspStatus) => {
    const ok = await tx.run(`Status set to ${status}`, s => setVaspStatus(s, vaspAddress, status).then(() => true))
    if (ok) reload()
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold">VASP Directory</h1>
            <p className="text-muted-foreground">Virtual Asset Service Providers registered on-chain</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90"
            >
              {showForm ? 'Cancel' : 'Register VASP'}
            </button>
          )}
        </div>

        {showForm && (
          <form onSubmit={handleRegister} className="bg-card border border-border rounded-lg p-6 mb-8 space-y-4">
            <h2 className="text-xl font-semibold">Register VASP</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input required placeholder="Stellar address (G…)" value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value.trim() })}
                className="px-3 py-2 border border-border rounded bg-background font-mono text-sm" />
              <input required placeholder="Legal name" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="px-3 py-2 border border-border rounded bg-background" />
              <select required value={form.jurisdiction} onChange={e => setForm({ ...form, jurisdiction: e.target.value })}
                className="px-3 py-2 border border-border rounded bg-background">
                <option value="">Jurisdiction…</option>
                {JURISDICTIONS.filter(j => j !== '*').map(j => <option key={j} value={j}>{j}</option>)}
              </select>
              <input placeholder="Registration valid for (days, optional)" type="number" min="1" value={form.expiresDays}
                onChange={e => setForm({ ...form, expiresDays: e.target.value })}
                className="px-3 py-2 border border-border rounded bg-background" />
              <input required placeholder="IVMS101 encryption public key (64 hex chars)" value={form.publicKeyHex}
                onChange={e => setForm({ ...form, publicKeyHex: e.target.value.trim() })}
                className="md:col-span-2 px-3 py-2 border border-border rounded bg-background font-mono text-sm" />
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button type="submit" disabled={tx.pending || !!formError}
              className="w-full px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {tx.pending ? 'Submitting…' : 'Register on-chain'}
            </button>
          </form>
        )}

        <div className="mb-4"><TxStatus {...tx} /></div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading from contract…</div>
        ) : error ? (
          <div className="text-center text-red-600 py-12">Error: {error}</div>
        ) : vasps.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No VASPs registered yet{isAdmin ? ' — use “Register VASP” above.' : '.'}
          </div>
        ) : (
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
                    {isAdmin && <th className="px-6 py-3 text-left text-sm font-semibold">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {vasps.map(vasp => {
                    const now = Date.now() / 1000
                    const isExpired = !!vasp.expiresAt && now >= vasp.expiresAt
                    const daysLeft = vasp.expiresAt ? Math.ceil((vasp.expiresAt - now) / 86400) : null
                    return (
                      <tr key={vasp.address} className={`border-b border-border hover:bg-muted/50 ${isExpired ? 'bg-red-50' : ''}`}>
                        <td className="px-6 py-4 font-medium">{vasp.name}</td>
                        <td className="px-6 py-4 font-mono text-sm">
                          <ExplorerLink kind="account" id={vasp.address}>{formatAddress(vasp.address)}</ExplorerLink>
                        </td>
                        <td className="px-6 py-4">{vasp.jurisdiction}</td>
                        <td className="px-6 py-4"><StatusBadge status={vasp.status} type="vasp" /></td>
                        <td className="px-6 py-4 text-sm">
                          {vasp.expiresAt ? (
                            <span className={isExpired ? 'text-red-600 font-semibold' : 'text-muted-foreground'}>
                              {isExpired ? 'Expired' : `${daysLeft}d remaining`}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">No expiry</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-6 py-4 text-sm space-x-2 whitespace-nowrap">
                            {vasp.status !== VaspStatus.Active && (
                              <button disabled={tx.pending} onClick={() => changeStatus(vasp.address, VaspStatus.Active)}
                                className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:opacity-90 disabled:opacity-50">Activate</button>
                            )}
                            {vasp.status === VaspStatus.Active && (
                              <button disabled={tx.pending} onClick={() => changeStatus(vasp.address, VaspStatus.Suspended)}
                                className="px-3 py-1 bg-yellow-600 text-white rounded text-xs hover:opacity-90 disabled:opacity-50">Suspend</button>
                            )}
                            {vasp.status !== VaspStatus.Revoked && (
                              <button disabled={tx.pending} onClick={() => changeStatus(vasp.address, VaspStatus.Revoked)}
                                className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:opacity-90 disabled:opacity-50">Revoke</button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
