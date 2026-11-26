'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLedgerClock, useRole, useVasps } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { ClockWarning } from '@/components/ClockWarning'
import { ExplorerLink, TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { formatAddress, truncateMiddle, vaspKeyError } from '@/lib/format'
import { JURISDICTIONS, isContractConfigured, isRegistrableJurisdiction } from '@/lib/config'
import { isValidStellarAddress } from '@/lib/wallet'
import { registerVasp, setVaspExpiry, setVaspStatus } from '@/lib/contract'
import { expiryFromDays, expiryState } from '@/lib/vasp-expiry'
import { FIELD_LIMITS, lengthError } from '@/lib/limits'
import { VaspStatus, type VaspEntry } from '@/lib/types'
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable'
import { ConfirmDialog } from '@/components/ConfirmDialog'

const emptyForm = { address: '', name: '', jurisdiction: '', publicKeyHex: '', expiresDays: '' }

type StatusConfirmation = { vasp: VaspEntry; status: VaspStatus.Suspended | VaspStatus.Revoked }

export default function VaspsPage() {
  const { vasps, loading, error, reload } = useVasps()
  const clock = useLedgerClock()
  const { address } = useWallet()
  const { role } = useRole(address)
  const tx = useTx()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [confirming, setConfirming] = useState<StatusConfirmation | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [renewing, setRenewing] = useState<{ address: string; days: string } | null>(null)
  const isAdmin = role === 'admin'
  const trimmedReason = statusReason.trim()
  const reasonError = lengthError('Reason', trimmedReason, FIELD_LIMITS.reason)
  const canConfirmStatus = !!trimmedReason && !reasonError && !tx.pending

  const formError =
    form.address && !isValidStellarAddress(form.address)
      ? 'Address must be a Stellar public key (G…)'
      : form.publicKeyHex && vaspKeyError(form.publicKeyHex)
        ? vaspKeyError(form.publicKeyHex)
        : form.expiresDays && !(Number(form.expiresDays) >= 1)
          ? 'Validity must be at least 1 day; an expiry in the past would deactivate the VASP immediately'
          : form.jurisdiction && !isRegistrableJurisdiction(form.jurisdiction)
            ? 'Jurisdiction cannot be "*" — choose a real jurisdiction'
          : lengthError('Legal name', form.name, FIELD_LIMITS.name)

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

  const activateVasp = async (vaspAddress: string) => {
    const ok = await tx.run('Status set to active', s =>
      setVaspStatus(s, vaspAddress, VaspStatus.Active, '').then(() => true),
    )
    if (ok) reload()
  }

  const openStatusConfirmation = (vasp: VaspEntry, status: StatusConfirmation['status']) => {
    setStatusReason('')
    setConfirming({ vasp, status })
  }

  const cancelStatusConfirmation = () => {
    setConfirming(null)
    setStatusReason('')
  }

  const confirmStatusChange = async () => {
    if (!confirming || !canConfirmStatus) return
    const { vasp, status } = confirming
    const verb = status === VaspStatus.Revoked ? 'Revoked' : 'Suspended'
    const ok = await tx.run(`${verb} ${vasp.name}: ${trimmedReason}`, s =>
      setVaspStatus(s, vasp.address, status, trimmedReason).then(() => true),
    )
    if (ok) {
      cancelStatusConfirmation()
      reload()
    }
  }

  const renewExpiry = async (vaspAddress: string, expiresAt: number | undefined, label: string) => {
    const ok = await tx.run(label, s => setVaspExpiry(s, vaspAddress, expiresAt).then(() => true))
    if (ok) {
      setRenewing(null)
      reload()
    }
  }

  const submitRenew = (vaspAddress: string) => {
    if (!renewing) return
    const expiresAt = expiryFromDays(renewing.days, Date.now() / 1000)
    if (expiresAt === null) return
    renewExpiry(vaspAddress, expiresAt, `Expiry set to ${renewing.days} days from now`)
  }

  const renewForm = (vaspAddress: string) => (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={`renew-${vaspAddress}`}>Valid for</label>
      <input id={`renew-${vaspAddress}`} type="number" min="1" inputMode="numeric"
        placeholder="days from now" value={renewing?.days ?? ''}
        onChange={e => setRenewing({ address: vaspAddress, days: e.target.value })}
        className="w-40 px-3 py-1 border border-border rounded bg-background" />
      <button disabled={tx.pending || expiryFromDays(renewing?.days ?? '', Date.now() / 1000) === null}
        onClick={() => submitRenew(vaspAddress)}
        className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs hover:opacity-90 disabled:opacity-50">
        Set expiry
      </button>
      <button disabled={tx.pending || !vasps.find(v => v.address === vaspAddress)?.expiresAt}
        onClick={() => renewExpiry(vaspAddress, undefined, 'Expiry removed')}
        className="px-3 py-1 bg-muted rounded text-xs hover:opacity-90 disabled:opacity-50">
        Remove expiry
      </button>
    </div>
  )

  const vaspColumns: Column<VaspEntry>[] = [
    { header: 'Name', className: 'font-medium', cell: v => (
      <Link href={`/vasps/view?address=${v.address}`} className="text-primary hover:underline">{v.name}</Link>
    ) },
    { header: 'Address', className: 'font-mono text-sm', cell: v => (
      <ExplorerLink kind="account" id={v.address}>{formatAddress(v.address)}</ExplorerLink>
    ) },
    { header: 'Jurisdiction', cell: v => v.jurisdiction },
    { header: 'Encryption key', className: 'font-mono text-xs', cell: v => (
      v.publicKey
        ? <span title={v.publicKey}>{truncateMiddle(v.publicKey)}</span>
        : <span className="text-muted-foreground">—</span>
    ) },
    { header: 'Status', cell: v => <StatusBadge status={v.status} type="vasp" /> },
    { header: 'Expires', className: 'text-sm', cell: v => {
      const state = expiryState(v.expiresAt, Date.now() / 1000)
      if (state.kind === 'none') return <span className="text-muted-foreground">No expiry</span>
      if (state.kind === 'expired') return <span className="text-red-600 font-semibold">Expired</span>
      if (state.kind === 'expiring-soon') return <span className="text-amber-700 font-semibold">Expires soon · {state.daysLeft}d remaining</span>
      return <span className="text-muted-foreground">{state.daysLeft}d remaining</span>
    } },
    ...(isAdmin ? [{ header: 'Actions', className: 'text-sm', cell: (v: VaspEntry) => (
      <div className="flex flex-wrap gap-2">
        {v.status !== VaspStatus.Active && (
          <button disabled={tx.pending} onClick={() => activateVasp(v.address)}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:opacity-90 disabled:opacity-50">Activate</button>
        )}
        {v.status === VaspStatus.Active && (
          <button disabled={tx.pending} onClick={() => openStatusConfirmation(v, VaspStatus.Suspended)}
            className="px-3 py-1 bg-yellow-600 text-white rounded text-xs hover:opacity-90 disabled:opacity-50">Suspend</button>
        )}
        {v.status !== VaspStatus.Revoked && (
          <button disabled={tx.pending} onClick={() => openStatusConfirmation(v, VaspStatus.Revoked)}
            className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:opacity-90 disabled:opacity-50">Revoke</button>
        )}
        <button disabled={tx.pending}
          onClick={() => setRenewing(renewing?.address === v.address ? null : { address: v.address, days: '' })}
          className="px-3 py-1 bg-muted rounded text-xs hover:opacity-90 disabled:opacity-50">Renew</button>
      </div>
    ) }] : []),
  ]

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
              <div className="space-y-1">
                <label htmlFor="vasp-address" className="block text-sm font-medium">Stellar address (required)</label>
                <input id="vasp-address" required placeholder="G…" value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value.trim() })}
                  className="w-full px-3 py-2 border border-border rounded bg-background font-mono text-sm" />
              </div>
              <div className="space-y-1">
                <label htmlFor="vasp-name" className="block text-sm font-medium">Legal name (required)</label>
                <input id="vasp-name" required placeholder="Legal name" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} maxLength={FIELD_LIMITS.name}
                  className="w-full px-3 py-2 border border-border rounded bg-background" />
              </div>
              <div className="space-y-1">
                <label htmlFor="vasp-jurisdiction" className="block text-sm font-medium">Jurisdiction (required)</label>
                <select id="vasp-jurisdiction" required value={form.jurisdiction} onChange={e => setForm({ ...form, jurisdiction: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded bg-background">
                  <option value="">Select a jurisdiction</option>
                  {JURISDICTIONS.filter(j => j !== '*').map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="vasp-expires-days" className="block text-sm font-medium">Registration valid for (days, optional)</label>
                <input id="vasp-expires-days" type="number" min="1" value={form.expiresDays}
                  onChange={e => setForm({ ...form, expiresDays: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded bg-background" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label htmlFor="vasp-public-key" className="block text-sm font-medium">IVMS101 encryption public key (64 hex chars, required)</label>
                <input id="vasp-public-key" required placeholder="64 hex characters" value={form.publicKeyHex}
                  onChange={e => setForm({ ...form, publicKeyHex: e.target.value.trim() })}
                  className="w-full px-3 py-2 border border-border rounded bg-background font-mono text-sm" />
              </div>
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button type="submit" disabled={tx.pending || !!formError}
              className="w-full px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {tx.pending ? 'Submitting…' : 'Register on-chain'}
            </button>
          </form>
        )}

        <div className="mb-4"><TxStatus {...tx} /></div>

        <ClockWarning clock={clock} />

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading from contract…</div>
        ) : error ? (
          <div className="text-center text-red-600 py-12">Error: {error}</div>
        ) : vasps.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            {!isContractConfigured
              ? 'The ComplyRail contract is not deployed yet, so there are no VASPs to show.'
              : !address
                ? 'No VASPs registered yet. Connect your wallet to see whether you can register one.'
                : <>No VASPs registered yet{isAdmin ? ' — use “Register VASP” above.' : '.'}</>}
          </div>
        ) : (
          <ResponsiveTable
            rows={vasps}
            rowKey={vasp => vasp.address}
            rowClassName={vasp => {
              const state = expiryState(vasp.expiresAt, Date.now() / 1000).kind
              return state === 'expired' ? 'bg-red-50' : state === 'expiring-soon' ? 'bg-amber-50' : ''
            }}
            columns={vaspColumns}
            expandedRow={vasp => (isAdmin && renewing?.address === vasp.address ? renewForm(vasp.address) : null)}
          />
        )}

        {confirming && (
          <ConfirmDialog
            title={`${confirming.status === VaspStatus.Revoked ? 'Revoke' : 'Suspend'} ${confirming.vasp.name}?`}
            consequences={confirming.status === VaspStatus.Revoked ? (
              <>
                Revoking <strong>{confirming.vasp.name}</strong> ({formatAddress(confirming.vasp.address)}) is permanent: this
                VASP will no longer be able to send or receive payments and cannot be reactivated. The reason is recorded
                in the on-chain audit log.
              </>
            ) : (
              <>
                Suspending <strong>{confirming.vasp.name}</strong> ({formatAddress(confirming.vasp.address)}) will block it
                from sending or receiving payments until an admin reactivates it. The reason is recorded in the on-chain
                audit log.
              </>
            )}
            confirmLabel={confirming.status === VaspStatus.Revoked ? 'Confirm revocation' : 'Confirm suspension'}
            confirmDisabled={!canConfirmStatus}
            onCancel={cancelStatusConfirmation}
            onConfirm={confirmStatusChange}
          >
            <label className="block space-y-1 text-sm">
              <span>Reason <span className="text-muted-foreground">(required, recorded on-chain)</span></span>
              <input
                value={statusReason}
                maxLength={FIELD_LIMITS.reason}
                onChange={e => setStatusReason(e.target.value)}
                placeholder="Why are you changing this status?"
                className="w-full rounded border border-border bg-background px-3 py-2"
              />
            </label>
            {reasonError && <p className="text-sm text-red-600" role="alert">{reasonError}</p>}
          </ConfirmDialog>
        )}
      </div>
    </div>
  )
}
