'use client'

import { useState } from 'react'
import { useAdmin, usePayment, useVasp } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { ExplorerLink, TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { assetSymbol } from '@/lib/config'
import { formatAddress, fromUnits } from '@/lib/format'
import {
  buildIvmsPayload,
  reclaimExpired,
  rejectPayment,
  releasePayment,
  sha256Hex,
  submitAttestation,
} from '@/lib/contract'
import { PaymentStatus } from '@/lib/types'

export default function PaymentDetailPage({ params }: { params: { id: string } }) {
  const { payment, loading, error, reload } = usePayment(params.id)
  const fromVasp = useVasp(payment?.fromVasp || '')
  const toVasp = useVasp(payment?.toVasp || '')
  const { admin } = useAdmin()
  const { address } = useWallet()
  const tx = useTx()
  const [names, setNames] = useState({ originator: '', beneficiary: '' })
  const [payloadJson, setPayloadJson] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  if (loading) return <Shell><div className="text-center text-muted-foreground">Loading from contract…</div></Shell>
  if (error || !payment) return <Shell><div className="text-center text-red-600">Payment #{params.id} not found</div></Shell>

  const pending = payment.status === PaymentStatus.Pending
  const isOriginator = address === payment.fromVasp
  const canResolve = !!address && (address === payment.toVasp || address === admin)
  const needsAttestation = payment.requiresAttestation && !payment.attestationHash
  const expired = Date.now() / 1000 >= payment.expiresAt

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
      originatorAccount: payment.fromVasp,
      beneficiaryName: names.beneficiary,
      beneficiaryAccount: payment.beneficiary,
      amount: fromUnits(payment.amount),
      asset: assetSymbol(payment.asset),
    })
    const json = JSON.stringify(payload)
    const hash = await sha256Hex(json)
    setPayloadJson(JSON.stringify(payload, null, 2))
    await act('Attestation recorded on-chain', s => submitAttestation(s, payment.id, hash, 'IVMS101.2023'))
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

      {payment.attestationHash && (
        <Card title="Attestation">
          <Row label="IVMS101 payload hash (sha256)"><span className="font-mono break-all">{payment.attestationHash}</span></Row>
          {payment.ivmsVersion && <Row label="Version">{payment.ivmsVersion}</Row>}
          {payment.attestedAt && <Row label="Submitted">{new Date(payment.attestedAt * 1000).toLocaleString()}</Row>}
        </Card>
      )}

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
            <input required placeholder="Beneficiary full name" value={names.beneficiary}
              onChange={e => setNames({ ...names, beneficiary: e.target.value })}
              className="px-3 py-2 border border-border rounded bg-background" />
          </div>
          <button type="submit" disabled={tx.pending}
            className="w-full px-4 py-2 rounded bg-blue-600 text-white hover:opacity-90 disabled:opacity-50">
            Hash & submit attestation
          </button>
          {payloadJson && (
            <details className="text-xs">
              <summary className="cursor-pointer">Payload that was hashed</summary>
              <pre className="mt-2 p-3 bg-muted rounded overflow-x-auto">{payloadJson}</pre>
            </details>
          )}
        </form>
      )}

      {pending && canResolve && (
        <Card title="Resolve payment">
          <p className="text-sm text-muted-foreground mb-4">
            {needsAttestation
              ? 'Release is blocked until the originating VASP submits an attestation.'
              : 'Check the IVMS101 payload you received matches the on-chain hash, then release or reject.'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button disabled={tx.pending || needsAttestation}
              onClick={() => act('Payment released to beneficiary', s => releasePayment(s, payment.id))}
              className="px-4 py-2 rounded bg-green-600 text-white hover:opacity-90 disabled:opacity-50">
              Release to beneficiary
            </button>
            <div className="flex gap-2">
              <input placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)}
                className="flex-1 px-3 py-2 border border-border rounded bg-background text-sm" />
              <button disabled={tx.pending || !reason}
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
