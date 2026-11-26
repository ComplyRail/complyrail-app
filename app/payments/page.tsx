'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { usePayments } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { useWallet } from '@/components/WalletProvider'
import { assetSymbol, isContractConfigured } from '@/lib/config'
import { formatAddress, fromUnits } from '@/lib/format'
import { PaymentStatus } from '@/lib/types'
import { ResponsiveTable } from '@/components/ResponsiveTable'

const STATUS_OPTIONS: Array<{ value: '' | PaymentStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: PaymentStatus.Pending, label: 'Pending' },
  { value: PaymentStatus.Released, label: 'Released' },
  { value: PaymentStatus.Rejected, label: 'Rejected' },
  { value: PaymentStatus.Reclaimed, label: 'Reclaimed' },
]

export default function PaymentsPage() {
  const { payments, total, hasMore, loadMore, loadingMore, moreError, loading, error } = usePayments()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const statusFilter = (searchParams.get('status') as PaymentStatus | null) || ''
  const addressFilter = searchParams.get('vasp') || ''

  const setFilters = (next: { status?: string; vasp?: string }) => {
    const params = new URLSearchParams(searchParams.toString())
    const status = next.status ?? statusFilter
    const vasp = next.vasp ?? addressFilter
    if (status) params.set('status', status)
    else params.delete('status')
    if (vasp) params.set('vasp', vasp)
    else params.delete('vasp')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const count = (s: PaymentStatus) => payments.filter(p => p.status === s).length
  const awaitingAttestation = payments.filter(
    p => p.status === PaymentStatus.Pending && p.requiresAttestation && !p.attestationHash,
  ).length
  const pending = count(PaymentStatus.Pending) - awaitingAttestation

  const needle = addressFilter.trim().toLowerCase()
  const filteredPayments = payments.filter(p => {
    if (statusFilter && p.status !== statusFilter) return false
    if (!needle) return true
    return [p.fromVasp, p.toVasp, p.beneficiary].some(addr => addr.toLowerCase().includes(needle))
  })

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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <Stat label="Total" value={payments.length} />
          <Stat label="Pending" value={pending} className="text-yellow-600" />
          <Stat label="Awaiting attestation" value={awaitingAttestation} className="text-orange-600" />
          <Stat label="Released" value={count(PaymentStatus.Released)} className="text-green-600" />
          <Stat label="Rejected" value={count(PaymentStatus.Rejected)} className="text-red-600" />
          <Stat label="Reclaimed" value={count(PaymentStatus.Reclaimed)} className="text-purple-600" />
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Counts cover the {payments.length} loaded payment{payments.length === 1 ? '' : 's'}.
        </p>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Status</span>
            <select
              value={statusFilter}
              onChange={e => setFilters({ status: e.target.value })}
              className="px-3 py-2 border border-border rounded bg-background"
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm flex-1">
            <span className="text-muted-foreground">VASP address</span>
            <input
              value={addressFilter}
              onChange={e => setFilters({ vasp: e.target.value })}
              placeholder="Search by VASP address"
              className="px-3 py-2 border border-border rounded bg-background font-mono"
              aria-label="Search by VASP address"
            />
          </label>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Loading from contract…</div>
        ) : error ? (
          <div className="text-center text-red-600 py-12">Error: {error}</div>
        ) : payments.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No payments yet</div>
        ) : filteredPayments.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No payments match the current filters</div>
        ) : (
          <ResponsiveTable
            rows={filteredPayments}
            rowKey={p => p.id}
            columns={[
              { header: '#', className: 'font-mono text-sm', cell: p => (
                <Link href={`/payments/view?id=${p.id}`} className="text-primary hover:underline">#{p.id}</Link>
              ) },
              { header: 'From VASP', className: 'font-mono text-sm', cell: p => formatAddress(p.fromVasp) },
              { header: 'To VASP', className: 'font-mono text-sm', cell: p => formatAddress(p.toVasp) },
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
