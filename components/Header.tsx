'use client'

import Link from 'next/link'
import { useState } from 'react'
import { formatAddress } from '@/lib/mockData'

export function Header({
  connectedAddress,
  onConnect,
  onDisconnect
}: {
  connectedAddress?: string
  onConnect: () => void
  onDisconnect: () => void
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <header className="border-b border-border bg-card">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <span className="bg-primary text-primary-foreground px-2 py-1 rounded">CR</span>
              ComplyRail
            </Link>
            <div className="hidden md:flex gap-6">
              <Link href="/vasps" className="text-sm font-medium hover:text-primary">
                VASPs
              </Link>
              <Link href="/thresholds" className="text-sm font-medium hover:text-primary">
                Thresholds
              </Link>
              <Link href="/payments" className="text-sm font-medium hover:text-primary">
                Payments
              </Link>
              <Link href="/audit" className="text-sm font-medium hover:text-primary">
                Audit Log
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {connectedAddress ? (
              <>
                <div className="hidden sm:block px-3 py-2 bg-accent/10 rounded text-sm font-mono">
                  {formatAddress(connectedAddress)}
                </div>
                <button
                  onClick={onDisconnect}
                  className="px-4 py-2 rounded border border-border hover:bg-muted"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={onConnect}
                className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>
    </header>
  )
}
