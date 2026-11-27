'use client'

import Link from 'next/link'
import { useLedgerClock, useVasp } from '@/lib/hooks'
import { StatusBadge } from '@/components/StatusBadge'
import { ClockWarning } from '@/components/ClockWarning'
import { CopyButton } from '@/components/CopyButton'
import { ExplorerLink } from '@/components/Notice'
import { formatAddress } from '@/lib/format'
import { expiryState } from '@/lib/vasp-expiry'

export function VaspDetail({ address }: { address: string }) {
  const { vasp, loading, error } = useVasp(address)
  const clock = useLedgerClock()

  if (loading) {
    return (
      <Shell>
        <p className="text-center text-muted-foreground">Loading from contract…</p>
      </Shell>
    )
  }

  if (error || !vasp) {
    return (
      <Shell>
        <p className="text-center text-red-600">VASP {formatAddress(address)} not found.</p>
      </Shell>
    )
  }

  const expiry = expiryState(vasp.expiresAt, clock.now)

  return (
    <Shell>
      <div className="mb-6">
        <Link href="/vasps" className="text-sm text-primary hover:underline">
          ← Back to VASP Directory
        </Link>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{vasp.name}</h1>
        <StatusBadge status={vasp.status} type="vasp" />
      </div>

      <ClockWarning clock={clock} />

      <div className="bg-card border border-border rounded-lg p-6 mb-6 space-y-4 text-sm">
        <Row label="Address">
          <ExplorerLink kind="account" id={vasp.address}>{vasp.address}</ExplorerLink>
        </Row>
        <Row label="Jurisdiction">{vasp.jurisdiction}</Row>
        <Row label="Registered">{new Date(vasp.addedAt * 1000).toLocaleString()}</Row>
        <Row label="Registration expires">
          {expiry.kind === 'none' && 'No expiry'}
          {expiry.kind === 'expired' && <span className="text-red-600 font-semibold">Expired</span>}
          {expiry.kind === 'expiring-soon' && (
            <span className="text-amber-700 font-semibold">
              {new Date(vasp.expiresAt! * 1000).toLocaleString()} · {expiry.daysLeft}d remaining
            </span>
          )}
          {expiry.kind === 'active' && (
            <span className="text-muted-foreground">
              {new Date(vasp.expiresAt! * 1000).toLocaleString()} · {expiry.daysLeft}d remaining
            </span>
          )}
        </Row>
      </div>

      <section className="bg-card border border-border rounded-lg p-6 text-sm space-y-3">
        <div>
          <h2 className="text-lg font-semibold">IVMS101 encryption public key</h2>
          <p className="text-muted-foreground">
            Other VASPs encrypt Travel Rule payloads to this key. It is public; the matching private key stays with
            this VASP and is never requested here.
          </p>
        </div>
        {vasp.publicKey ? (
          <div className="flex flex-wrap items-start gap-3">
            <code className="flex-1 min-w-0 break-all font-mono text-xs bg-muted/50 rounded p-3">{vasp.publicKey}</code>
            <CopyButton value={vasp.publicKey} label="VASP encryption key" />
          </div>
        ) : (
          <p className="text-muted-foreground">No encryption key is registered for this VASP.</p>
        )}
      </section>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-3xl mx-auto">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4">
      <div className="text-muted-foreground">{label}</div>
      <div className="sm:col-span-2 break-all">{children}</div>
    </div>
  )
}
