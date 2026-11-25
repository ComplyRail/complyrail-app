'use client'

import { useState } from 'react'
import { useAdmin, useAuditEvents, useLedgerClock, usePayment, useVasp } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { IvmsDecryptPanel } from './IvmsDecryptPanel'
import { ClockWarning } from '@/components/ClockWarning'
import { ExplorerLink, TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { assetSymbol } from '@/lib/config'
import { formatAddress, fromUnits } from '@/lib/format'
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
import { IVMS101_VERSION, PaymentStatus } from '@/lib/types'
import { FIELD_LIMITS, lengthError } from '@/lib/limits'
import { verifyIvmsPayload, type PayloadCheck } from '@/lib/ivms'

export function PaymentDetail({ id }: { id: string }) {
  const { payment, loading, error, reload } = usePayment(id)
  const clock = useLedgerClock()
  const fromVasp = useVasp(payment?.fromVasp || '')
  const toVasp = useVasp(payment?.toVasp || '')
  const { admin } = useAdmin()
  const {
    events: auditEvents,
    truncated: auditEventsTruncated,
    loading: auditEventsLoading,
    error: auditEventsError,
  } = useAuditEvents()
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
  if (error || !payment) return <Shell><div className="text-center text-red-600">Payment #{id} not found</div></Shell>

  const pending = payment.status === PaymentStatus.Pending
  const isOriginator = address === payment.fromVasp
  const canResolve = !!address && (address === payment.toVasp || address === admin)
  const needsAttestation = payment.requiresAttestation && !payment.attestationHash
  const expired = clock.now >= payment.expiresAt
  const attestationEvents = auditEvents
    .filter(event => (
      (event.type === 'att_sub' || event.type === 'att_amd') &&
      event.subject === payment.id
    ))
    .sort((a, b) => a.ledger - b.ledger || a.timestamp - b.timestamp)
  const attestationTimeline: {
    id: string
    hash: string | undefined
    version: string | undefined
    timestamp: number
    label: string
  }[] = []
  for (const event of attestationEvents) {
    if (event.type === 'att_sub') {
      attestationTimeline.push({
        id: event.id,
        hash: event.details?.hash,
        version: event.details?.ivms_version,
        timestamp: event.timestamp,
        label: event.description,
      })
      continue
    }

    const previousHash = event.details?.old_hash
    if (previousHash && !attestationTimeline.some(item => item.hash === previousHash)) {
      attestationTimeline.push({
        id: `${event.id}-previous`,
        hash: previousHash,
        version: undefined,
        timestamp: event.timestamp,
        label: 'Previous attestation',
      })
    }
    attestationTimeline.push({
      id: event.id,
      hash: event.details?.new_hash,
      version: event.details?.ivms_version,
      timestamp: event.timestamp,
      label: event.description,
    })
  }
  if (payment.attestationHash && !attestationTimeline.some(item => item.hash === payment.attestationHash)) {
    attestationTimeline.push({
      id: `current-${payment.id}`,
      hash: payment.attestationHash,
      version: payment.ivmsVersion,
      timestamp: payment.attestedAt ?? payment.createdAt,
      label: 'Current attestation (event not available)',
    })
  }

  const checkReceived = async (json: string) => {
    setReceived(json)
    setReceivedCheck(json.trim() ? await verifyIvmsPayload(json, payment.attestationHash || '') : null)
  }

  const releaseAllowed = !needsAttestation && (receivedCheck?.status === 'match' || overrideRelease)

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
            <ExplorerLink kind="account" id={payment.fromVasp}>{formatAddress(payment.fromVasp)}</ExplorerLink>
            {fromVasp.vasp && <span className="text-muted-foreground"> · {fromVasp.vasp.name} ({fromVasp.vasp.jurisdiction})</span>}
          </Row>
          <Row label="To VASP">
            <ExplorerLink kind="account" id={payment.toVasp}>{formatAddress(payment.toVasp)}</ExplorerLink>
            {toVasp.vasp && <span className="text-muted-foreground"> · {toVasp.vasp.name} ({toVasp.vasp.jurisdiction})</span>}
          </Row>
          <Row label="Beneficiary">
            <ExplorerLink kind="account" id={payment.beneficiary}>{formatAddress(payment.beneficiary)}</ExplorerLink>
          </Row>
        </Card>
      </div>

      {(payment.attestationHash || attestationTimeline.length > 0) && (
        <Card title="Attestation">
          <p className="text-xs text-muted-foreground">
            Attestation events available from the contract RPC are shown below; older events may no longer be retained.
          </p>
          {auditEventsLoading && <p className="text-sm text-muted-foreground">Loading attestation events…</p>}
          {auditEventsError && (
            <p role="alert" className="text-sm text-red-600">Unable to load attestation history: {auditEventsError}</p>
          )}
          {auditEventsTruncated && (
            <p role="status" className="text-sm text-yellow-800">
              The event limit was reached; some older attestation events may be missing.
            </p>
          )}
          <ol aria-label="Attestation history" className="space-y-4">
            {attestationTimeline.map(item => (
              <li key={item.id} className="border-l-2 border-border pl-4">
                <p className="font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.timestamp * 1000).toLocaleString()}</p>
                <Row label="IVMS101 payload hash (sha256)">
                  <span className="font-mono break-all">{item.hash ?? 'Unavailable'}</span>
                </Row>
                <Row label="Version">{item.version ?? 'Unknown'}</Row>
              </li>
            ))}
          </ol>
          {payment.externalRef && <Row label="External ref"><code className="break-all">{payment.externalRef}</code></Row>}
        </Card>
      )}

      <ClockWarning clock={clock} />

      <div className="my-4"><TxStatus {...tx} /></div>

      {pending && isOriginator && needsAttestation && (
        <form onSubmit={handleAttest} className="bg-card border border-border rounded-lg p-6 mb-6 space-y-4">
          <h2 className="text-lg font-semibold">Submit IVMS101 attestation</h2>
          <p className="text-sm text-muted-foreground">
            The payload below is hashed in your browser; only the hash goes on-chain. Send the full payload to the
            receiving VASP over your Travel Rule channel so they can verify it.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input required placeholder="Originator full name" value={names.originator}
              onChange={e => setNames({ ...names, originator: e.target.value })}
              className="px-3 py-2 border border-border rounded bg-background" />
            <input required placeholder="Originator account (customer account number)" value={names.originatorAccount}
              onChange={e => setNames({ ...names, originatorAccount: e.target.value })}
              className="px-3 py-2 border border-border rounded bg-background" />
            <input required placeholder="Beneficiary full name" value={names.beneficiary}
              onChange={e => setNames({ ...names, beneficiary: e.target.value })}
              className="px-3 py-2 border border-border rounded bg-background" />
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

      {pending && canResolve && (
        <Card title="Resolve payment">
          <p className="text-sm text-muted-foreground mb-4">
            {needsAttestation
              ? 'Release is blocked until the originating VASP submits an attestation.'
              : 'Check the IVMS101 payload you received matches the on-chain hash, then release or reject.'}
          </p>
          {!needsAttestation && (
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
            <button disabled={tx.pending || !releaseAllowed}
              onClick={() => act('Payment released to beneficiary', s => releasePayment(s, payment.id))}
              className="px-4 py-2 rounded bg-green-600 text-white hover:opacity-90 disabled:opacity-50">
              Release to beneficiary
            </button>
            <div className="flex gap-2">
              <input placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)}
                maxLength={FIELD_LIMITS.reason}
                className="flex-1 px-3 py-2 border border-border rounded bg-background text-sm" />
              <button disabled={tx.pending || !reason.trim() || !!lengthError('Reason', reason, FIELD_LIMITS.reason)}
                onClick={() => act('Payment rejected and refunded', s => rejectPayment(s, payment.id, reason))}
                className="px-4 py-2 rounded bg-red-600 text-white hover:opacity-90 disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        </Card>
      )}

      {pending && isOriginator && expired && (
        <button disabled={tx.pending} onClick={() => act('Funds reclaimed', s => reclaimExpired(s, payment.id))}
          className="w-full mt-4 px-4 py-3 rounded bg-muted hover:bg-muted/80 font-medium disabled:opacity-50">
          Reclaim expired payment
        </button>
      )}

      {pending && !isOriginator && !canResolve && (
        <p className="text-sm text-muted-foreground">
          Connect as the originating VASP to attest, or as the receiving VASP / admin to release or reject.
        </p>
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
