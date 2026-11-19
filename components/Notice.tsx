'use client'

import { useCallback, useState } from 'react'
import { explorerBase, isContractConfigured } from '@/lib/config'
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

export { friendlyError }

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
