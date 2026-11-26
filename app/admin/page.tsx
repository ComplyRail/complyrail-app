'use client'

import Link from 'next/link'
import { useState } from 'react'
import deployment from '../../contracts/deployments/testnet.json'
import { ExplorerLink, TxStatus, useTx } from '@/components/Notice'
import { useWallet } from '@/components/WalletProvider'
import { useAdmin, usePayments, usePendingAdmin, useVasps } from '@/lib/hooks'
import { config, isContractConfigured } from '@/lib/config'
import { acceptAdmin, cancelAdminProposal, proposeAdmin } from '@/lib/contract'

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/

export default function ContractPage() {
  const { admin, loading, reload: reloadAdmin } = useAdmin()
  const { vasps } = useVasps()
  const { total: paymentTotal } = usePayments()
  const { address } = useWallet()
  const record = deployment as Record<string, string>
  // The deployment file can describe a different contract when an env override is in use.
  const metadataMatchesContract = record.contractId === config.contractId

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
            {metadataMatchesContract ? (
              <>
                {record.deployedAt && <Row label="Deployed">{record.deployedAt.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC')}</Row>}
                {record.wasmHash && <Row label="WASM sha256"><span className="font-mono break-all">{record.wasmHash}</span></Row>}
                {record.commit && (
                  <Row label="Source commit">
                    <a className="text-primary hover:underline font-mono" target="_blank" rel="noreferrer"
                      href={`https://github.com/ComplyRail/complyrail-app/commit/${record.commit}`}>{record.commit.slice(0, 7)}</a>
                  </Row>
                )}
              </>
            ) : (
              <Row label="Deployment metadata">metadata unavailable for this contract</Row>
            )}
            <Row label="Registered VASPs">{vasps.length}</Row>
            <Row label="Payments">{paymentTotal}</Row>
          </div>
        )}

        {isContractConfigured && <TransferAdminCard admin={admin} onAdminChanged={reloadAdmin} />}

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

/**
 * Two-step admin handover: the admin proposes, then the proposed address
 * accepts from its own wallet. Either step can be run separately.
 */
function TransferAdminCard({ admin, onAdminChanged }: { admin: string | null; onAdminChanged: () => void }) {
  const { address } = useWallet()
  const { pendingAdmin, reload: reloadPending } = usePendingAdmin()
  const tx = useTx()
  const [newAdmin, setNewAdmin] = useState('')
  const [addressError, setAddressError] = useState<string | null>(null)
  const isAdmin = !!address && address === admin
  const isPending = !!address && address === pendingAdmin

  const propose = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = newAdmin.trim()
    if (!STELLAR_ADDRESS.test(target)) {
      setAddressError('Enter a Stellar public key (G…, 56 characters).')
      return
    }
    setAddressError(null)
    const ok = await tx.run('Admin transfer proposed', s => proposeAdmin(s, target).then(() => true))
    if (ok) {
      setNewAdmin('')
      reloadPending()
    }
  }

  const cancel = async () => {
    const ok = await tx.run('Admin proposal cancelled', s => cancelAdminProposal(s).then(() => true))
    if (ok) reloadPending()
  }

  const accept = async () => {
    const ok = await tx.run('Admin role accepted', s => acceptAdmin(s).then(() => true))
    if (ok) {
      reloadPending()
      onAdminChanged()
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 text-sm space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Transfer admin</h2>
        <p className="text-muted-foreground">
          The current admin proposes a new address; that address then accepts from its own wallet.
        </p>
      </div>

      {pendingAdmin ? (
        <div className="flex flex-wrap items-center gap-3">
          <span>Pending admin:</span>
          <ExplorerLink kind="account" id={pendingAdmin} />
          {isAdmin && (
            <button onClick={cancel} disabled={tx.pending}
              className="px-3 py-1 rounded border border-border hover:bg-muted disabled:opacity-50">
              Cancel proposal
            </button>
          )}
          {isPending && (
            <button onClick={accept} disabled={tx.pending}
              className="px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Accept admin role
            </button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">No pending proposal.</p>
      )}

      {isAdmin && (
        <form onSubmit={propose} className="flex flex-col gap-2 sm:flex-row">
          <input required value={newAdmin} onChange={e => setNewAdmin(e.target.value)}
            placeholder="New admin address (G…)" aria-label="New admin address"
            className="flex-1 px-3 py-2 border border-border rounded bg-background font-mono" />
          <button type="submit" disabled={tx.pending}
            className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {tx.pending ? 'Submitting…' : pendingAdmin ? 'Replace proposal' : 'Propose new admin'}
          </button>
        </form>
      )}
      {addressError && <p className="text-sm text-red-600">{addressError}</p>}
      <TxStatus {...tx} />
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
