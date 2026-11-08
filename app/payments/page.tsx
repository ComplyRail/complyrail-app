'use client'

import Link from 'next/link'
import { usePayments } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { assetSymbol } from '@/lib/config'
import { formatAddress, fromUnits } from '@/lib/format'
import { PaymentStatus } from '@/lib/types'

export default function PaymentsPage() {
  const { payments, loading, error } = usePayments()

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
          <Stat label="Total" value={payments.length} />
          <Stat label="Pending" value={count(PaymentStatus.Pending)} className="text-yellow-600" />
          <Stat label="Awaiting attestation" value={awaitingAttestation} className="text-orange-600" />
          <Stat label="Released" value={count(PaymentStatus.Released)} className="text-green-600" />
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading from contract…</div>
        ) : error ? (
          <div className="text-center text-red-600 py-12">Error: {error}</div>
        ) : payments.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No payments yet</div>
        ) : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-6 py-3 text-left text-sm font-semibold">#</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">From VASP</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">To VASP</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Amount</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-b border-border hover:bg-muted/50">
                      <td className="px-6 py-4 font-mono text-sm">
                        <Link href={`/payments/${p.id}`} className="text-primary hover:underline">#{p.id}</Link>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm">{formatAddress(p.fromVasp)}</td>
                      <td className="px-6 py-4 font-mono text-sm">{formatAddress(p.toVasp)}</td>
                      <td className="px-6 py-4 font-mono">{fromUnits(p.amount)} {assetSymbol(p.asset)}</td>
                      <td className="px-6 py-4"><StatusBadge status={p.status} type="payment" /></td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {new Date(p.createdAt * 1000).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
