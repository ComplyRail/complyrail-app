'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLedgerClock, useRole, useVasps } from '@/lib/hooks'
import { TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { ASSETS, assetSymbol } from '@/lib/config'
import { exceedsBalance, fromUnits, toUnits } from '@/lib/format'
import { isValidStellarAddress } from '@/lib/wallet'
import { getAssetBalance, submitPayment } from '@/lib/contract'
import { VaspStatus } from '@/lib/types'
import { expiryState } from '@/lib/vasp-expiry'
import { externalRefArg } from '@/lib/contract'

export default function NewPaymentPage() {
  const router = useRouter()
  const { vasps } = useVasps()
  const clock = useLedgerClock()
  const { address } = useWallet()
  const { role } = useRole(address)
  const tx = useTx()
  const [form, setForm] = useState({
    toVasp: '',
    beneficiary: '',
    asset: ASSETS[0].contractId,
    amount: '',
    externalRef: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [balanceError, setBalanceError] = useState(false)
  // The contract picks the threshold by the originator's jurisdiction, so the
  // preview has to look it up the same way rather than assuming a flat limit.
  const { vasp: originVasp } = useVasp(address ?? '')
  const { threshold, loading: thresholdLoading } = useThreshold(form.asset, originVasp?.jurisdiction)

  // Refresh the connected wallet's balance whenever the wallet or asset changes.
  useEffect(() => {
    let live = true
    setBalance(null)
    setBalanceError(false)
    if (!address) return
    getAssetBalance(form.asset, address)
      .then(b => live && setBalance(b))
      .catch(() => live && setBalanceError(true))
    return () => {
      live = false
    }
  }, [address, form.asset])

  const parsedAmount = (() => {
    try {
      return toUnits(form.amount)
    } catch {
      return null
    }
  })()
  const overBalance = parsedAmount !== null && exceedsBalance(parsedAmount, balance)

  // Mirrors `submit_payment`: amount >= threshold needs an attestation, and a
  // missing rule reads as 0, so the preview fails closed like the contract does.
  const attestationPreview = (() => {
    if (!address || !originVasp?.jurisdiction || parsedAmount === null || parsedAmount <= 0n) return null
    if (thresholdLoading || threshold === null) {
      return { tone: 'checking' as const, text: 'Checking the Travel Rule threshold…' }
    }
    const limit = `${fromUnits(threshold)} ${assetSymbol(form.asset)} for ${originVasp.jurisdiction}`
    return parsedAmount >= threshold
      ? {
          tone: 'required' as const,
          text: `Attestation required: this is at or above the ${limit} threshold, so the payment is held in escrow until the receiving VASP releases it.`,
        }
      : {
          tone: 'immediate' as const,
          text: `Settles immediately: this is below the ${limit} threshold, so the beneficiary is paid in the same transaction.`,
        }
  })()

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const registeredCounterparties = vasps.filter(v => v.status === VaspStatus.Active && v.address !== address)
  const expiredCounterparties = registeredCounterparties.filter(
    v => expiryState(v.expiresAt, clock.now).kind === 'expired',
  )
  const selectableCounterparties = registeredCounterparties.filter(
    v => expiryState(v.expiresAt, clock.now).kind !== 'expired',
  )

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
    if (exceedsBalance(amount, balance)) return setFormError('Amount is more than your wallet balance')
    try {
      externalRefArg(form.externalRef)
    } catch (err) {
      return setFormError(err instanceof Error ? err.message : 'Invalid external reference')
    }
    const id = await tx.run('Payment submitted', s => submitPayment(s, { ...form, amount }))
    if (id !== undefined) router.push(`/payments/view?id=${id}`)
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

        {address && role === 'inactive-vasp' && (
          <div className="mb-6 p-4 rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-900">
            The connected wallet is a registered VASP but is suspended, revoked or expired, so the contract will reject
            this payment. Ask the admin to reactivate it on the VASP page.
          </div>
        )}
        {address && role !== 'vasp' && role !== 'inactive-vasp' && (
          <div className="mb-6 p-4 rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-900">
            The connected wallet is not a registered VASP, so the contract will reject this payment. Ask the admin to
            register it on the VASP page first.
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-8 space-y-6">
          <Field label="To VASP">
            <select name="toVasp" value={form.toVasp} onChange={onChange} required className={inputCls}>
              <option value="">Select beneficiary VASP…</option>
              {selectableCounterparties.map(v => (
                <option key={v.address} value={v.address}>{v.name} ({v.jurisdiction})</option>
              ))}
              {expiredCounterparties.length > 0 && (
                <optgroup label="Unavailable - expired registration">
                  {expiredCounterparties.map(v => (
                    <option key={v.address} value={v.address} disabled>
                      {v.name} ({v.jurisdiction}) - expired
                    </option>
                  ))}
                </optgroup>
              )}
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
              {attestationPreview && (
                <p data-testid="attestation-preview" className={`mt-2 text-sm ${PREVIEW_TONE[attestationPreview.tone]}`}>
                  {attestationPreview.text}
                </p>
              )}
              {address && (
                <p data-testid="balance" className="mt-2 text-sm text-muted-foreground">
                  {balanceError
                    ? 'Balance unavailable'
                    : balance === null
                      ? 'Checking balance…'
                      : `Available: ${fromUnits(balance)} ${assetSymbol(form.asset)}`}
                </p>
              )}
              {overBalance && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  This amount is more than your balance of {assetSymbol(form.asset)}. Lower the amount to submit.
                </p>
              )}
            </div>
          </div>

          <Field label="External reference (optional)">
            <input name="externalRef" value={form.externalRef} onChange={onChange} placeholder="64 hex characters"
              className={`${inputCls} font-mono text-sm`} />
          </Field>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <TxStatus {...tx} />

          <button type="submit" disabled={tx.pending || overBalance}
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

const PREVIEW_TONE = {
  checking: 'text-muted-foreground',
  required: 'text-orange-700',
  immediate: 'text-green-700',
} as const

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      {children}
    </div>
  )
}
