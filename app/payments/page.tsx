'use client'

import Link from 'next/link'
import { usePayments } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { formatAddress } from '@/lib/mockData'

export default function PaymentsPage() {
  const { payments, loading, error } = usePayments()

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Payment Queue</h1>
          <div className="text-center text-muted-foreground">Loading...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Payment Queue</h1>
          <div className="text-center text-red-600">Error: {error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Payment Queue</h1>
            <p className="text-muted-foreground">View and manage all payments</p>
          </div>
          <Link
            href="/payments/new"
            className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            Submit Payment
          </Link>
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold">ID</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">From VASP</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">To VASP</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Amount</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Created</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-border hover:bg-muted/50">
                    <td className="px-6 py-4 font-mono text-sm">
                      <Link href={`/payments/${payment.id}`} className="text-primary hover:underline">
                        {formatAddress(payment.id)}
                      </Link>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm">{formatAddress(payment.fromVasp)}</td>
                    <td className="px-6 py-4 font-mono text-sm">{formatAddress(payment.toVasp)}</td>
                    <td className="px-6 py-4 font-mono">{payment.amount}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={payment.status} type="payment" />
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {new Date(payment.createdAt * 1000).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/payments/${payment.id}`}
                        className="text-primary hover:underline text-sm"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {payments.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No payments yet
          </div>
        )}
      </div>
    </div>
  )
}
