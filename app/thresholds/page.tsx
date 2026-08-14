'use client'

import { useState } from 'react'
import { useThresholds } from '@/lib/hooks'

const COMMON_ASSETS = [
  { address: 'GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN', symbol: 'USDC' },
]

const JURISDICTIONS = ['US', 'GB', 'EU', 'SG', 'HK', 'JP', 'AU', 'CA']

export default function ThresholdsPage() {
  const { thresholds } = useThresholds()
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ asset: '', jurisdiction: '', amount: '' })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Mock submission
    alert(`Threshold set: ${formData.amount} for ${formData.jurisdiction}`)
    setFormData({ asset: '', jurisdiction: '', amount: '' })
    setShowForm(false)
  }

  const thresholdArray = Array.from(thresholds.entries()).map(([key, amount]) => {
    const [asset, jurisdiction] = key.split(':')
    const assetSymbol = COMMON_ASSETS.find(a => a.address === asset)?.symbol || 'USDC'
    return { asset, assetSymbol, jurisdiction, amount }
  })

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Threshold Configuration</h1>
            <p className="text-muted-foreground">Manage payment thresholds by asset and jurisdiction</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            {showForm ? 'Cancel' : 'Add Threshold'}
          </button>
        </div>

        {showForm && (
          <div className="bg-card border border-border rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">New Threshold</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Asset</label>
                  <select
                    value={formData.asset}
                    onChange={(e) => setFormData({ ...formData, asset: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-border rounded bg-background"
                  >
                    <option value="">Select asset...</option>
                    {COMMON_ASSETS.map((asset) => (
                      <option key={asset.address} value={asset.address}>
                        {asset.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Jurisdiction</label>
                  <select
                    value={formData.jurisdiction}
                    onChange={(e) => setFormData({ ...formData, jurisdiction: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-border rounded bg-background"
                  >
                    <option value="">Select jurisdiction...</option>
                    {JURISDICTIONS.map((j) => (
                      <option key={j} value={j}>{j}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Threshold Amount</label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  required
                  placeholder="10000"
                  className="w-full px-3 py-2 border border-border rounded bg-background"
                />
              </div>
              <button
                type="submit"
                className="w-full px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                Set Threshold
              </button>
            </form>
          </div>
        )}

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold">Asset</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Jurisdiction</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Threshold Amount</th>
                </tr>
              </thead>
              <tbody>
                {thresholdArray.map((threshold) => (
                  <tr key={`${threshold.asset}:${threshold.jurisdiction}`} className="border-b border-border hover:bg-muted/50">
                    <td className="px-6 py-4 font-medium">{threshold.assetSymbol}</td>
                    <td className="px-6 py-4">{threshold.jurisdiction}</td>
                    <td className="px-6 py-4 font-mono">{threshold.amount.toString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {thresholdArray.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No thresholds configured
          </div>
        )}
      </div>
    </div>
  )
}
