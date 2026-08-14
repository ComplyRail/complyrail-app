'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useVasps } from '@/lib/hooks'

const COMMON_ASSETS = [
  { address: 'GBUQWP3BOUZX34SYMPHV3SH6MZLHEMGJLKJQPREXY63JBCGTAQON22TN', symbol: 'USDC' },
]

export default function NewPaymentPage() {
  const router = useRouter()
  const { vasps } = useVasps()
  const [formData, setFormData] = useState({
    toVasp: '',
    beneficiary: '',
    asset: '',
    amount: '',
  })
  const [loading, setLoading] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      // Mock submission
      await new Promise(resolve => setTimeout(resolve, 500))
      const paymentId = Math.random().toString(36).substring(7)
      alert(`Payment submitted with ID: ${paymentId}`)
      router.push('/payments')
    } catch (error) {
      alert('Failed to submit payment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Submit Payment</h1>
          <p className="text-muted-foreground">Initiate a new payment between VASPs</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">To VASP</label>
              <select
                name="toVasp"
                value={formData.toVasp}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">Select beneficiary VASP...</option>
                {vasps.map(vasp => (
                  <option key={vasp.address} value={vasp.address}>
                    {vasp.name} ({vasp.jurisdiction})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Beneficiary Address</label>
              <input
                type="text"
                name="beneficiary"
                value={formData.beneficiary}
                onChange={handleChange}
                placeholder="G..."
                required
                className="w-full px-4 py-2 border border-border rounded bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Asset</label>
              <select
                name="asset"
                value={formData.asset}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-border rounded bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">Select asset...</option>
                {COMMON_ASSETS.map(asset => (
                  <option key={asset.address} value={asset.address}>
                    {asset.symbol}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Amount</label>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleChange}
                placeholder="0"
                required
                step="0.01"
                min="0"
                className="w-full px-4 py-2 border border-border rounded bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium"
            >
              {loading ? 'Submitting...' : 'Submit Payment'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
