'use client'

import Link from 'next/link'
import { usePayments } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { assetSymbol } from '@/lib/config'
import { fromUnits } from '@/lib/format'
import { PaymentStatus } from '@/lib/types'
import { ResponsiveTable } from '@/components/ResponsiveTable'
import { CopyableValue } from '@/components/CopyableValue'

export default function PaymentsPage() {
  const { payments, total, hasMore, loadMore, loadingMore, moreError, loading, error } = usePayments()

  const count = (s: PaymentStatus) => payments.filter(p => p.status === s).length
  const awaitingAttestation = payments.filter(
    p => p.status === PaymentStatus.Pending && p.requiresAttestation && !p.attestationHash,
  ).length

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold">Payment Queue</h1>
            <p className="text-muted-foreground">Inter-VASP payments held in the ComplyRail escrow</p>
          </div>
          <Link href="/payments/new" className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90">
            Submit Payment
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Stat label="Total" value={total} />
          <Stat label="Pending" value={count(PaymentStatus.Pending)} className="text-yellow-600" />
          <Stat label="Awaiting attestation" value={awaitingAttestation} className="text-orange-600" />
          <Stat label="Released" value={count(PaymentStatus.Released)} className="text-green-600" />
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Status counts cover the {payments.length} loaded payment{payments.length === 1 ? '' : 's'}.
        </p>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading from contract…</div>
        ) : error ? (
          <div className="text-center text-red-600 py-12">Error: {error}</div>
        ) : payments.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No payments yet</div>
        ) : (
          <ResponsiveTable
            rows={payments}
            rowKey={p => p.id}
            columns={[
              { header: '#', className: 'font-mono text-sm', cell: p => (
                <Link href={`/payments/view?id=${p.id}`} className="text-primary hover:underline">#{p.id}</Link>
              ) },
              { header: 'From VASP', className: 'font-mono text-sm', cell: p => (
                <CopyableValue value={p.fromVasp} variant="address" label="Copy from VASP address" />
              ) },
              { header: 'To VASP', className: 'font-mono text-sm', cell: p => (
                <CopyableValue value={p.toVasp} variant="address" label="Copy to VASP address" />
              ) },
              { header: 'Amount', className: 'font-mono', cell: p => <>{fromUnits(p.amount)} {assetSymbol(p.asset)}</> },
              { header: 'Status', cell: p => <StatusBadge status={p.status} type="payment" /> },
              { header: 'Created', className: 'text-sm text-muted-foreground', cell: p => new Date(p.createdAt * 1000).toLocaleString() },
            ]}
          />
        )}

        {hasMore && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <button onClick={loadMore} disabled={loadingMore}
              className="px-4 py-2 rounded border border-border bg-card hover:bg-muted disabled:opacity-50">
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
            {moreError && <p className="text-sm text-red-600">Error: {moreError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, className = '' }: { label: string; value: number; className?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${className}`}>{value}</div>
    </div>
  )
}
