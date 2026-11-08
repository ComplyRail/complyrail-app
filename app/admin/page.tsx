'use client'

import Link from 'next/link'
import deployment from '../../contracts/deployments/testnet.json'
import { ExplorerLink } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { useAdmin, usePayments, useVasps } from '@/lib/hooks'
import { config, isContractConfigured } from '@/lib/config'

export default function ContractPage() {
  const { admin, loading } = useAdmin()
  const { vasps } = useVasps()
  const { payments } = usePayments()
  const { address } = useWallet()
  const record = deployment as Record<string, string>

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Contract</h1>
          <p className="text-muted-foreground">Live deployment of the ComplyRail Soroban contract</p>
        </div>

        {!isContractConfigured ? (
          <div className="bg-card border border-border rounded-lg p-6 text-sm space-y-2">
            <p>No deployment yet. To deploy:</p>
            <ol className="list-decimal ml-6 space-y-1">
              <li>Open the repo on GitHub → <strong>Actions</strong> → <strong>Deploy to testnet</strong>.</li>
              <li>Click <strong>Run workflow</strong> and paste your wallet&apos;s public address (G…) as admin.</li>
              <li>The job records the contract ID in <code>contracts/deployments/testnet.json</code> and this page updates on the next deploy of the site.</li>
            </ol>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-lg p-6 text-sm space-y-3">
            <Row label="Network">Stellar testnet</Row>
            <Row label="Contract ID">
              <ExplorerLink kind="contract" id={config.contractId} />
            </Row>
            <Row label="Admin">
              {loading ? '…' : admin ? <ExplorerLink kind="account" id={admin} /> : 'unknown'}
              {address && admin === address && <span className="ml-2 text-green-700">(you)</span>}
            </Row>
            <Row label="RPC">{config.rpcUrl}</Row>
            {record.deployedAt && <Row label="Deployed">{record.deployedAt.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC')}</Row>}
            {record.wasmHash && <Row label="WASM sha256"><span className="font-mono break-all">{record.wasmHash}</span></Row>}
            {record.commit && (
              <Row label="Source commit">
                <a className="text-primary hover:underline font-mono" target="_blank" rel="noreferrer"
                  href={`https://github.com/ComplyRail/complyrail-app/commit/${record.commit}`}>{record.commit.slice(0, 7)}</a>
              </Row>
            )}
            <Row label="Registered VASPs">{vasps.length}</Row>
            <Row label="Payments">{payments.length}</Row>
          </div>
        )}

        <div className="bg-card border border-border rounded-lg p-6 text-sm space-y-2">
          <h2 className="text-lg font-semibold">Admin tasks</h2>
          <p className="text-muted-foreground">Connect the admin wallet, then:</p>
          <ul className="list-disc ml-6 space-y-1">
            <li><Link href="/vasps" className="text-primary hover:underline">Register, suspend or revoke VASPs</Link></li>
            <li><Link href="/thresholds" className="text-primary hover:underline">Set Travel Rule thresholds</Link></li>
            <li><Link href="/payments" className="text-primary hover:underline">Release or reject held payments</Link></li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2 break-all">{children}</div>
    </div>
  )
}
