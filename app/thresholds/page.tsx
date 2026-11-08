'use client'

import { useState } from 'react'
import { useRole, useThresholds } from '@/lib/hooks'
import { TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { ASSETS, JURISDICTIONS, assetSymbol } from '@/lib/config'
import { fromUnits, toUnits } from '@/lib/format'
import { setThreshold } from '@/lib/contract'

export default function ThresholdsPage() {
  const { thresholds, loading, error, reload } = useThresholds()
  const { address } = useWallet()
  const { role } = useRole(address)
  const tx = useTx()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ asset: '', jurisdiction: '', amount: '' })
  const [amountError, setAmountError] = useState<string | null>(null)
  const isAdmin = role === 'admin'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    let units: bigint
    try {
      units = toUnits(form.amount)
      setAmountError(null)
    } catch (err) {
      setAmountError(err instanceof Error ? err.message : 'Invalid amount')
      return
    }
    const ok = await tx.run(`Threshold set for ${form.jurisdiction}`, s =>
      setThreshold(s, form.asset, form.jurisdiction, units).then(() => true),
    )
    if (ok) {
      setForm({ asset: '', jurisdiction: '', amount: '' })
      setShowForm(false)
      reload()
    }
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold">Threshold Configuration</h1>
            <p className="text-muted-foreground">
              Payments at or above the threshold need a Travel Rule attestation before release.
            </p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90">
              {showForm ? 'Cancel' : 'Set Threshold'}
            </button>
          )}
        </div>

        <div className="mb-6 text-sm text-muted-foreground bg-muted/40 border border-border rounded p-4">
          Rules are looked up by the <em>originating</em> VASP&apos;s jurisdiction, then the <code>*</code> fallback.
          With no matching rule the threshold is <strong>0</strong>, so every payment needs an attestation (fail closed).
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-6 mb-8 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <select required value={form.asset} onChange={e => setForm({ ...form, asset: e.target.value })}
                className="px-3 py-2 border border-border rounded bg-background">
                <option value="">Asset…</option>
                {ASSETS.map(a => <option key={a.contractId} value={a.contractId}>{a.symbol}</option>)}
              </select>
              <select required value={form.jurisdiction} onChange={e => setForm({ ...form, jurisdiction: e.target.value })}
                className="px-3 py-2 border border-border rounded bg-background">
                <option value="">Jurisdiction…</option>
                {JURISDICTIONS.map(j => <option key={j} value={j}>{j === '*' ? '* (fallback)' : j}</option>)}
              </select>
              <input required inputMode="decimal" placeholder="Amount, e.g. 1000" value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="px-3 py-2 border border-border rounded bg-background" />
            </div>
            {amountError && <p className="text-sm text-red-600">{amountError}</p>}
            <button type="submit" disabled={tx.pending}
              className="w-full px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {tx.pending ? 'Submitting…' : 'Save on-chain'}
            </button>
          </form>
        )}

        <div className="mb-4"><TxStatus {...tx} /></div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading from contract…</div>
        ) : error ? (
          <div className="text-center text-red-600 py-12">Error: {error}</div>
        ) : thresholds.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No thresholds configured — every payment currently requires an attestation.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold">Asset</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Jurisdiction</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Threshold</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map(t => (
                  <tr key={`${t.asset}:${t.jurisdiction}`} className="border-b border-border hover:bg-muted/50">
                    <td className="px-6 py-4 font-medium">{assetSymbol(t.asset)}</td>
                    <td className="px-6 py-4">{t.jurisdiction === '*' ? '* (fallback)' : t.jurisdiction}</td>
                    <td className="px-6 py-4 font-mono">{fromUnits(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
