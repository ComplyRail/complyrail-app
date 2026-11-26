'use client'

import { useState } from 'react'
import { useAdmin, useLedgerClock, usePayment, useVasp } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { IvmsDecryptPanel } from './IvmsDecryptPanel'
import { ClockWarning } from '@/components/ClockWarning'
import { ExplorerLink, TxStatus, useTx } from '@/components/Notice'
import { CopyableValue } from '@/components/CopyableValue'
import { useWallet } from '@/components/WalletProvider'
import { assetSymbol } from '@/lib/config'
import { formatAddress, fromUnits } from '@/lib/format'
import { CONTRACT_ERRORS } from '@/lib/errors'
import { rejectBlockReason, releaseBlockReason } from '@/lib/payment-actions'
import {
  buildIvmsPayload,
  canonicalJson,
  reclaimExpired,
  rejectPayment,
  releasePayment,
  sha256Hex,
  submitAttestation,
} from '@/lib/contract'
import { sealIvmsPayload } from '@/lib/ivms-crypto'
import { IVMS101_VERSION, PaymentStatus, VaspStatus } from '@/lib/types'
import { expiryState } from '@/lib/vasp-expiry'
import { FIELD_LIMITS } from '@/lib/limits'
import { verifyIvmsPayload, type PayloadCheck } from '@/lib/ivms'

export function PaymentDetail({ id }: { id: string }) {
  const { payment, loading, error, reload } = usePayment(id)
  const clock = useLedgerClock()
  const fromVasp = useVasp(payment?.fromVasp || '')
  const toVasp = useVasp(payment?.toVasp || '')
  const { admin } = useAdmin()
  const { address } = useWallet()
  const tx = useTx()
  const [names, setNames] = useState({ originator: '', originatorAccount: '', beneficiary: '' })
  const [envelope, setEnvelope] = useState<string | null>(null)
  const [sealError, setSealError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [received, setReceived] = useState('')
  const [receivedCheck, setReceivedCheck] = useState<PayloadCheck | null>(null)
  const [overrideRelease, setOverrideRelease] = useState(false)

  if (loading) return <Shell><div className="text-center text-muted-foreground">Loading from contract…</div></Shell>
  if (error) {
    return (
      <Shell>
        <div className="text-center py-12 space-y-4">
          <p className="text-red-600">Failed to load payment: {error}</p>
          <button
            type="button"
            onClick={reload}
            className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </Shell>
    )
  }
  if (!payment) return <Shell><div className="text-center text-red-600 py-12">Payment #{id} not found</div></Shell>

  const pending = payment.status === PaymentStatus.Pending
  const isOriginator = address === payment.fromVasp
  const canResolve = !!address && (address === payment.toVasp || address === admin)
  const attestationPending = payment.requiresAttestation && !payment.attestationHash
  const verifyPayload = payment.requiresAttestation && !!payment.attestationHash
  const expired = clock.now >= payment.expiresAt

  const checkReceived = async (json: string) => {
    setReceived(json)
    setReceivedCheck(json.trim() ? await verifyIvmsPayload(json, payment.attestationHash || '') : null)
  }

  const receivingVaspActive =
    !toVasp.vasp ||
    (toVasp.vasp.status === VaspStatus.Active &&
      expiryState(toVasp.vasp.expiresAt, clock.now).kind !== 'expired')
  const actionState = {
    payment,
    address,
    admin,
    now: clock.now,
    receivingVaspActive,
    received: receivedCheck,
    override: overrideRelease,
  }
  const releaseReason = releaseBlockReason(actionState)
  const rejectReason = rejectBlockReason(actionState, reason)

  // Reasons are shown next to disabled controls rather than replacing them, so
  // the user can tell a permission problem from a missing attestation and from
  // a payment that is already resolved.
  const blockedReason = (testId: string, text: string) => (
    <p id={testId} data-testid={testId} className="text-xs text-muted-foreground">
      {text}
    </p>
  )

  const act = async (label: string, fn: Parameters<typeof tx.run>[1]) => {
    const ok = await tx.run(label, async s => {
      await fn(s)
      return true
    })
    if (ok) reload()
  }

  const handleAttest = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = buildIvmsPayload({
      paymentId: payment.id,
      originatorName: names.originator,
      originatorAccount: names.originatorAccount,
      beneficiaryName: names.beneficiary,
      beneficiaryAccount: payment.beneficiary,
      amount: fromUnits(payment.amount),
      asset: assetSymbol(payment.asset),
    })
    const recipientKey = toVasp.vasp?.publicKey
    if (!recipientKey) {
      setSealError('The receiving VASP has no registered encryption key, so the payload cannot be encrypted.')
      return
    }
    setSealError(null)
    // Hash the RFC 8785 canonical form so any implementation can reproduce it,
    // and seal those same bytes so the recipient can verify the on-chain hash.
    const canonical = canonicalJson(payload)
    const hash = await sha256Hex(canonical)
    setEnvelope(await sealIvmsPayload(canonical, recipientKey))
    await act('Attestation recorded on-chain', s => submitAttestation(s, payment.id, hash, IVMS101_VERSION))
  }

  const downloadEnvelope = () => {
    if (!envelope) return
    const url = URL.createObjectURL(new Blob([envelope], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `ivms-payment-${payment.id}.enc.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Shell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Payment #{payment.id}</h1>
        <div className="flex items-center gap-3">
          <StatusBadge status={payment.status} type="payment" />
          {payment.requiresAttestation && (
            <span className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-800">Above threshold: attestation required</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card title="Payment">
          <Row label="Amount"><span className="font-mono">{fromUnits(payment.amount)} {assetSymbol(payment.asset)}</span></Row>
          <Row label="Created">{new Date(payment.createdAt * 1000).toLocaleString()}</Row>
          <Row label="Expires">{new Date(payment.expiresAt * 1000).toLocaleString()}{expired && pending ? ' (expired)' : ''}</Row>
          {payment.resolvedAt && <Row label="Resolved">{new Date(payment.resolvedAt * 1000).toLocaleString()}</Row>}
        </Card>
        <Card title="Parties">
          <Row label="From VASP">
            <CopyableValue value={payment.fromVasp} variant="address" label="Copy from VASP address">
              <ExplorerLink kind="account" id={payment.fromVasp}>{formatAddress(payment.fromVasp)}</ExplorerLink>
            </CopyableValue>
            {fromVasp.vasp && <span className="text-muted-foreground"> · {fromVasp.vasp.name} ({fromVasp.vasp.jurisdiction})</span>}
          </Row>
          <Row label="To VASP">
            <CopyableValue value={payment.toVasp} variant="address" label="Copy to VASP address">
              <ExplorerLink kind="account" id={payment.toVasp}>{formatAddress(payment.toVasp)}</ExplorerLink>
            </CopyableValue>
            {toVasp.vasp && <span className="text-muted-foreground"> · {toVasp.vasp.name} ({toVasp.vasp.jurisdiction})</span>}
          </Row>
          <Row label="Beneficiary">
            <CopyableValue value={payment.beneficiary} variant="address" label="Copy beneficiary address">
              <ExplorerLink kind="account" id={payment.beneficiary}>{formatAddress(payment.beneficiary)}</ExplorerLink>
            </CopyableValue>
          </Row>
        </Card>
      </div>

      {payment.attestationHash && (
        <Card title="Attestation">
          <Row label="IVMS101 payload hash (sha256)">
            <CopyableValue value={payment.attestationHash} label="Copy attestation hash" />
          </Row>
          {payment.ivmsVersion && <Row label="Version">{payment.ivmsVersion}</Row>}
          {payment.externalRef && (
            <Row label="External ref">
              <CopyableValue value={payment.externalRef} label="Copy external reference" />
            </Row>
          )}
          {payment.attestedAt && <Row label="Submitted">{new Date(payment.attestedAt * 1000).toLocaleString()}</Row>}
        </Card>
      )}

      <ClockWarning clock={clock} />

      <div className="my-4"><TxStatus {...tx} /></div>

      {pending && isOriginator && attestationPending && (
        <form onSubmit={handleAttest} className="bg-card border border-border rounded-lg p-6 mb-6 space-y-4">
          <h2 className="text-lg font-semibold">Submit IVMS101 attestation</h2>
          <p className="text-sm text-muted-foreground">
            The payload below is hashed in your browser; only the hash goes on-chain. Send the full payload to the
            receiving VASP over your Travel Rule channel so they can verify it.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="attestation-originator-name" className="block text-sm font-medium">Originator full name (required)</label>
              <input id="attestation-originator-name" required placeholder="Full name" value={names.originator}
                onChange={e => setNames({ ...names, originator: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded bg-background" />
            </div>
            <div className="space-y-1">
              <label htmlFor="attestation-originator-account" className="block text-sm font-medium">Originator account (customer account number, required)</label>
              <input id="attestation-originator-account" required placeholder="Customer account number" value={names.originatorAccount}
                onChange={e => setNames({ ...names, originatorAccount: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded bg-background" />
            </div>
            <div className="space-y-1">
              <label htmlFor="attestation-beneficiary-name" className="block text-sm font-medium">Beneficiary full name (required)</label>
              <input id="attestation-beneficiary-name" required placeholder="Full name" value={names.beneficiary}
                onChange={e => setNames({ ...names, beneficiary: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded bg-background" />
            </div>
          </div>
          <button type="submit" disabled={tx.pending}
            className="w-full px-4 py-2 rounded bg-blue-600 text-white hover:opacity-90 disabled:opacity-50">
            Hash & submit attestation
          </button>
          {sealError && <p className="text-sm text-red-600">{sealError}</p>}
          {envelope && (
            <div className="text-xs space-y-2">
              <p className="text-muted-foreground">
                Encrypted to the receiving VASP&apos;s key. Download it and send it to them; the plaintext is not shown here.
              </p>
              <button type="button" onClick={downloadEnvelope}
                className="px-3 py-1 rounded bg-muted hover:bg-muted/80 font-medium">
                Download encrypted payload
              </button>
              <pre className="p-3 bg-muted rounded overflow-x-auto">{envelope}</pre>
            </div>
          )}
        </form>
      )}

      {address === payment.toVasp && payment.attestationHash && toVasp.vasp?.publicKey && (
        <IvmsDecryptPanel recipientPublicKey={toVasp.vasp.publicKey} attestationHash={payment.attestationHash} />
      )}

      {pending && (
        <Card title="Resolve payment">
          <p className="text-sm text-muted-foreground mb-4">
            {!canResolve
              ? 'Release and reject are only available to the receiving VASP or the admin.'
              : needsAttestation
                ? 'Release is blocked until the originating VASP submits an attestation.'
                : 'Check the IVMS101 payload you received matches the on-chain hash, then release or reject.'}
          </p>
          {canResolve && !needsAttestation && (
            <div className="space-y-2 mb-4">
              <label htmlFor="received-payload" className="block text-sm font-medium">Received IVMS101 payload (JSON)</label>
              <textarea id="received-payload" rows={6} value={received} placeholder="Paste the payload you received off-chain"
                onChange={e => checkReceived(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded bg-background font-mono text-xs" />
              {receivedCheck?.status === 'match' && (
                <p className="text-sm text-green-700">✓ Matches the on-chain attestation hash</p>
              )}
              {receivedCheck?.status === 'mismatch' && (
                <p className="text-sm text-red-600">✗ Does not match the on-chain attestation hash</p>
              )}
              {receivedCheck?.status === 'invalid' && (
                <p className="text-sm text-red-600">✗ {receivedCheck.error}</p>
              )}
              {receivedCheck?.status !== 'match' && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={overrideRelease} onChange={e => setOverrideRelease(e.target.checked)} />
                  Release without a verified payload (override)
                </label>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <button disabled={tx.pending || !!releaseReason}
                aria-describedby={releaseReason ? 'release-reason' : undefined}
                onClick={() => act('Payment released to beneficiary', s => releasePayment(s, payment.id))}
                className="w-full px-4 py-2 rounded bg-green-600 text-white hover:opacity-90 disabled:opacity-50">
                Release to beneficiary
              </button>
              {releaseReason && blockedReason('release-reason', `Release unavailable: ${releaseReason}`)}
            </div>
            <div className="space-y-1">
              <div className="flex gap-2">
                <input placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)}
                  maxLength={FIELD_LIMITS.reason} disabled={!canResolve}
                  aria-describedby={rejectReason ? 'reject-reason' : undefined}
                  className="flex-1 px-3 py-2 border border-border rounded bg-background text-sm disabled:opacity-50" />
                <button disabled={tx.pending || !!rejectReason}
                  onClick={() => act('Payment rejected and refunded', s => rejectPayment(s, payment.id, reason))}
                  className="px-4 py-2 rounded bg-red-600 text-white hover:opacity-90 disabled:opacity-50">
                  Reject
                </button>
              </div>
              {rejectReason && blockedReason('reject-reason', `Reject unavailable: ${rejectReason}`)}
            </div>
          </div>
        </Card>
      )}

      {pending && isOriginator && (
        <div className="mt-4 space-y-1">
          <button disabled={tx.pending || !expired} onClick={() => act('Funds reclaimed', s => reclaimExpired(s, payment.id))}
            aria-describedby={expired ? undefined : 'reclaim-reason'}
            className="w-full px-4 py-3 rounded bg-muted hover:bg-muted/80 font-medium disabled:opacity-50">
            Reclaim expired payment
          </button>
          {!expired && blockedReason('reclaim-reason', `Reclaim unavailable: ${CONTRACT_ERRORS[12]}`)}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">{children}</div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      <div className="space-y-3 text-sm">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  )
}
