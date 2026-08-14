'use client'

import Link from 'next/link'
import { Header } from '@/components/Header'
import { useState } from 'react'
import { useWalletUser } from '@/lib/hooks'

export default function Home() {
  const [connectedAddress, setConnectedAddress] = useState<string | undefined>()
  const user = useWalletUser(connectedAddress)

  const handleConnect = () => {
    // Mock wallet connection
    setConnectedAddress('GABC123DEFGHIJKLMNOPQRSTUVWXYZ')
  }

  const handleDisconnect = () => {
    setConnectedAddress(undefined)
  }

  return (
    <>
      <Header
        connectedAddress={connectedAddress}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      <div className="min-h-screen bg-gradient-to-br from-background to-muted">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center mb-16">
            <h1 className="text-5xl font-bold tracking-tight mb-4">
              On-Chain Compliance
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              FATF Travel Rule enforcement layer for Stellar anchors
            </p>
            {!connectedAddress && (
              <button
                onClick={handleConnect}
                className="px-8 py-3 rounded-lg bg-primary text-primary-foreground hover:opacity-90 font-medium text-lg"
              >
                Connect Wallet to Begin
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Link
              href="/vasps"
              className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition"
            >
              <div className="text-4xl mb-4">🏛️</div>
              <h3 className="text-xl font-semibold mb-2">VASP Directory</h3>
              <p className="text-muted-foreground">
                Register and manage Virtual Asset Service Providers
              </p>
            </Link>

            <Link
              href="/thresholds"
              className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition"
            >
              <div className="text-4xl mb-4">⚙️</div>
              <h3 className="text-xl font-semibold mb-2">Thresholds</h3>
              <p className="text-muted-foreground">
                Configure payment thresholds by asset and jurisdiction
              </p>
            </Link>

            <Link
              href="/payments"
              className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition"
            >
              <div className="text-4xl mb-4">💳</div>
              <h3 className="text-xl font-semibold mb-2">Payments</h3>
              <p className="text-muted-foreground">
                Submit and manage inter-VASP payments with attestation
              </p>
            </Link>

            <Link
              href="/payments/new"
              className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition"
            >
              <div className="text-4xl mb-4">📤</div>
              <h3 className="text-xl font-semibold mb-2">Submit Payment</h3>
              <p className="text-muted-foreground">
                Initiate a new compliant payment between VASPs
              </p>
            </Link>

            <Link
              href="/audit"
              className="bg-card border border-border rounded-lg p-8 hover:shadow-lg transition"
            >
              <div className="text-4xl mb-4">📋</div>
              <h3 className="text-xl font-semibold mb-2">Audit Log</h3>
              <p className="text-muted-foreground">
                View and export compliance audit trail and events
              </p>
            </Link>

            <div className="bg-card border border-border rounded-lg p-8">
              <div className="text-4xl mb-4">🔐</div>
              <h3 className="text-xl font-semibold mb-2">Security</h3>
              <p className="text-muted-foreground">
                {connectedAddress
                  ? `Connected as ${connectedAddress.slice(0, 10)}... (${user?.role || 'viewer'})`
                  : 'Connect wallet to authenticate'}
              </p>
            </div>
          </div>

          <div className="mt-20 bg-card border border-border rounded-lg p-12">
            <h2 className="text-2xl font-bold mb-4">About ComplyRail</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                ComplyRail is an open-source, on-chain compliance layer for Stellar anchors that enforces FATF Travel Rule requirements at the settlement layer.
              </p>
              <p>
                Our smart contracts implement threshold-gated payment escrow with on-chain VASP registry and IVMS101 attestation verification, enabling compliant cross-VASP payments.
              </p>
              <p className="text-sm text-red-600">
                ⚠️ This is a technical tool, not legal advice. FATF Travel Rule obligations vary by jurisdiction and carry real regulatory liability. Any production deployment requires legal/compliance review.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
