'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useWallet } from '@/components/WalletProvider'
import { useRole } from '@/lib/hooks'
import { formatAddress } from '@/lib/format'

const NAV = [
  { href: '/vasps', label: 'VASPs' },
  { href: '/thresholds', label: 'Thresholds' },
  { href: '/payments', label: 'Payments' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/admin', label: 'Contract' },
]

export function Header() {
  const { address, connecting, error, connect, disconnect } = useWallet()
  const { role } = useRole(address)
  const [open, setOpen] = useState(false)

  return (
    <header className="border-b border-border bg-card">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <span className="bg-primary text-primary-foreground px-2 py-1 rounded">CR</span>
              ComplyRail
            </Link>
            <div className="hidden md:flex gap-6">
              {NAV.map(n => (
                <Link key={n.href} href={n.href} className="text-sm font-medium hover:text-primary">
                  {n.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline px-2 py-1 rounded bg-yellow-100 text-yellow-800 text-xs font-medium">
              Testnet
            </span>
            {address ? (
              <>
                <div className="hidden sm:block px-3 py-2 bg-accent/10 rounded text-sm font-mono" title={address}>
                  {formatAddress(address)} · {role}
                </div>
                <button onClick={disconnect} className="px-4 py-2 rounded border border-border hover:bg-muted text-sm">
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={connect}
                disabled={connecting}
                className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 text-sm"
              >
                {connecting ? 'Connecting…' : 'Connect Wallet'}
              </button>
            )}
            <button className="md:hidden px-2 py-1 border border-border rounded" onClick={() => setOpen(!open)} aria-label="Menu">
              ☰
            </button>
          </div>
        </div>
        {open && (
          <div className="md:hidden flex flex-col gap-3 pb-4">
            {NAV.map(n => (
              <Link key={n.href} href={n.href} className="text-sm font-medium" onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            ))}
          </div>
        )}
        {error && <div className="pb-2 text-xs text-red-600">{error}</div>}
      </nav>
    </header>
  )
}
