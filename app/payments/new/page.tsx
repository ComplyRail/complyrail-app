'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRole, useVasps } from '@/lib/hooks'
import { TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { ASSETS } from '@/lib/config'
import { toUnits } from '@/lib/format'
import { isValidStellarAddress } from '@/lib/wallet'
import { submitPayment } from '@/lib/contract'
import { VaspStatus } from '@/lib/types'

export default function NewPaymentPage() {
  const router = useRouter()
  const { vasps } = useVasps()
  const { address } = useWallet()
  const { role } = useRole(address)
  const tx = useTx()
  const [form, setForm] = useState({ toVasp: '', beneficiary: '', asset: ASSETS[0].contractId, amount: '' })
  const [formError, setFormError] = useState<string | null>(null)

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const counterparties = vasps.filter(v => v.status === VaspStatus.Active && v.address !== address)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!isValidStellarAddress(form.beneficiary)) return setFormError('Beneficiary must be a Stellar address (G…)')
    let amount: bigint
    try {
      amount = toUnits(form.amount)
    } catch (err) {
      return setFormError(err instanceof Error ? err.message : 'Invalid amount')
    }
    if (amount <= 0n) return setFormError('Amount must be greater than zero')
    const id = await tx.run('Payment submitted', s => submitPayment(s, { ...form, amount }))
    if (id !== undefined) router.push(`/payments/${id}`)
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Submit Payment</h1>
          <p className="text-muted-foreground">
            Funds move from your VASP wallet into escrow. Below-threshold payments settle immediately; others wait for an
            attestation and release by the receiving VASP.
          </p>
        </div>

        {address && role !== 'vasp' && (
          <div className="mb-6 p-4 rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-900">
            The connected wallet is not a registered VASP, so the contract will reject this payment. Ask the admin to
            register it on the VASP page first.
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-8 space-y-6">
          <Field label="To VASP">
            <select name="toVasp" value={form.toVasp} onChange={onChange} required className={inputCls}>
              <option value="">Select beneficiary VASP…</option>
              {counterparties.map(v => (
                <option key={v.address} value={v.address}>{v.name} ({v.jurisdiction})</option>
              ))}
            </select>
          </Field>
          <Field label="Beneficiary address">
            <input name="beneficiary" value={form.beneficiary} onChange={onChange} placeholder="G…" required
              className={`${inputCls} font-mono text-sm`} />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Asset">
              <select name="asset" value={form.asset} onChange={onChange} className={inputCls}>
                {ASSETS.map(a => <option key={a.contractId} value={a.contractId}>{a.symbol}</option>)}
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="Amount">
                <input name="amount" inputMode="decimal" value={form.amount} onChange={onChange} placeholder="0.00" required
                  className={inputCls} />
              </Field>
            </div>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <TxStatus {...tx} />

          <button type="submit" disabled={tx.pending}
            className="w-full px-4 py-3 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium">
            {tx.pending ? 'Submitting…' : address ? 'Sign & submit payment' : 'Connect wallet to submit'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-4 py-2 border border-border rounded bg-background focus:ring-2 focus:ring-primary focus:border-transparent'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      {children}
    </div>
  )
}
