'use client'

import { useCallback, useEffect, useState } from 'react'
import { explorerBase, isContractConfigured } from '@/lib/config'
import { TxFailedError } from '@/lib/contract'
import { useWallet } from '@/components/WalletProvider'
import { friendlyError } from '@/lib/errors'

export function NotDeployedBanner() {
  if (isContractConfigured) return null
  return (
    <div className="bg-yellow-50 border-b border-yellow-200 text-yellow-900 text-sm px-4 py-3 text-center">
      The ComplyRail contract hasn&apos;t been deployed to testnet yet. Run the <strong>Deploy to testnet</strong> GitHub
      Action; this page reads live contract data once it&apos;s deployed.
    </div>
  )
}

/**
 * Small helper for contract writes: tracks pending/error/success state and
 * surfaces the simulated resource fee before the wallet approval dialog opens
 * (issue #1013).
 */
export function useTx() {
  const { signer, connect } = useWallet()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  // Simulated resource fee in XLM, set just before the wallet sign dialog opens.
  const [resourceFee, setResourceFee] = useState<string | null>(null)

  // Listen for the fee event emitted by lib/contract.ts write() after simulation
  // but before signAndSend(). The event carries { fee: '<xlm string>' }.
  useEffect(() => {
    const handler = (e: Event) => {
      const fee = (e as CustomEvent<{ fee: string }>).detail?.fee ?? null
      setResourceFee(fee)
    }
    window.addEventListener('complyrail:resourcefee', handler)
    return () => window.removeEventListener('complyrail:resourcefee', handler)
  }, [])

  const run = useCallback(
    async <T,>(label: string, fn: (s: NonNullable<typeof signer>) => Promise<T>): Promise<T | undefined> => {
      setError(null)
      setDone(null)
      setTxHash(null)
      setResourceFee(null)
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
        if (e instanceof TxFailedError) {
          setError(e.message)
          setTxHash(e.txHash || null)
        } else {
          setError(friendlyError(e))
        }
        return undefined
      } finally {
        setPending(false)
        // Keep the resource fee visible after the wallet returns so the user
        // can see what was charged. It is cleared at the start of the next run.
      }
    },
    [signer, connect],
  )

  return { run, pending, error, done, txHash, resourceFee, signedIn: !!signer }
}

export { friendlyError }

export function TxStatus({
  pending,
  error,
  done,
  txHash,
  resourceFee,
}: {
  pending: boolean
  error: string | null
  done: string | null
  /** Set when a transaction failed on-chain, so the user can inspect it. */
  txHash?: string | null
  /**
   * Simulated resource fee in XLM, set after simulation and before the wallet
   * approval dialog opens. Shown while pending so the user can see the fee
   * they are approving (issue #1013).
   */
  resourceFee?: string | null
}) {
  if (pending)
    return (
      <div className="text-sm text-muted-foreground space-y-1">
        <p>Waiting for wallet signature and confirmation…</p>
        {resourceFee && (
          <p className="text-xs">
            Estimated resource fee:{' '}
            <span className="font-mono font-medium">{resourceFee} XLM</span>
          </p>
        )}
      </div>
    )
  if (error)
    return (
      <p className="text-sm text-red-600">
        {error}
        {txHash && (
          <>
            {' '}
            <ExplorerLink kind="tx" id={txHash}>View transaction</ExplorerLink>
          </>
        )}
      </p>
    )
  if (done)
    return (
      <div className="text-sm text-green-700 space-y-1">
        <p>✓ {done}</p>
        {resourceFee && (
          <p className="text-xs text-muted-foreground">
            Resource fee charged:{' '}
            <span className="font-mono">{resourceFee} XLM</span>
          </p>
        )}
      </div>
    )
  return null
}

export function ExplorerLink({ kind, id, children }: { kind: 'contract' | 'account' | 'tx'; id: string; children?: React.ReactNode }) {
  if (!explorerBase) {
    return (
      <span className="text-muted-foreground" title="No block explorer is configured for this network">
        {children ?? id} <span className="text-xs">(unknown network)</span>
      </span>
    )
  }
  return (
    <a href={`${explorerBase}/${kind}/${id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {children ?? id}
    </a>
  )
}
