'use client'

import { useCallback, useState } from 'react'
import { explorerBase, isContractConfigured } from '@/lib/config'
import { useWallet } from '@/components/WalletProvider'

export function NotDeployedBanner() {
  if (isContractConfigured) return null
  return (
    <div className="bg-yellow-50 border-b border-yellow-200 text-yellow-900 text-sm px-4 py-3 text-center">
      The ComplyRail contract hasn&apos;t been deployed to testnet yet. Run the <strong>Deploy to testnet</strong> GitHub
      Action; this page reads live contract data once it&apos;s deployed.
    </div>
  )
}

/** Small helper for contract writes: tracks pending/error/success state. */
export function useTx() {
  const { signer, connect } = useWallet()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const run = useCallback(
    async <T,>(label: string, fn: (s: NonNullable<typeof signer>) => Promise<T>): Promise<T | undefined> => {
      setError(null)
      setDone(null)
      if (!signer) {
        await connect()
        setError('Connect your wallet, then try again.')
        return undefined
      }
      setPending(true)
      try {
        const out = await fn(signer)
        setDone(label)
        return out
      } catch (e) {
        setError(friendlyError(e))
        return undefined
      } finally {
        setPending(false)
      }
    },
    [signer, connect],
  )

  return { run, pending, error, done, signedIn: !!signer }
}

const CONTRACT_ERRORS: Record<number, string> = {
  2: 'Contract not initialised',
  3: 'This VASP is already registered',
  4: 'VASP not found',
  5: 'A VASP in this payment is not active (suspended, revoked or expired)',
  6: 'Amount must be greater than zero',
  7: 'Payment not found',
  8: 'This payment has already been resolved',
  9: 'An attestation is required before release',
  10: 'An attestation was already submitted',
  11: 'Only the beneficiary VASP or the admin can do this',
  12: 'This payment has not expired yet',
  13: 'Sender and receiver VASP must be different',
  14: 'Threshold must be zero or more',
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.match(/Error\(Contract, #(\d+)\)/)
  if (m && CONTRACT_ERRORS[Number(m[1])]) return CONTRACT_ERRORS[Number(m[1])]
  if (/not authorized|require_auth|InvalidAction/i.test(msg)) return 'Your wallet is not authorised for this action'
  if (/User declined|rejected/i.test(msg)) return 'Request cancelled in wallet'
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg
}

export function TxStatus({ pending, error, done }: { pending: boolean; error: string | null; done: string | null }) {
  if (pending) return <p className="text-sm text-muted-foreground">Waiting for wallet signature and confirmation…</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (done) return <p className="text-sm text-green-700">✓ {done}</p>
  return null
}

export function ExplorerLink({ kind, id, children }: { kind: 'contract' | 'account' | 'tx'; id: string; children?: React.ReactNode }) {
  return (
    <a href={`${explorerBase}/${kind}/${id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {children ?? id}
    </a>
  )
}
