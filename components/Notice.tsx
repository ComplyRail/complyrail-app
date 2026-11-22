'use client'

import { useCallback, useState } from 'react'
import { explorerBase, isContractConfigured } from '@/lib/config'
import { TxFailedError } from '@/lib/contract'
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
  const [txHash, setTxHash] = useState<string | null>(null)

  const run = useCallback(
    async <T,>(label: string, fn: (s: NonNullable<typeof signer>) => Promise<T>): Promise<T | undefined> => {
      setError(null)
      setDone(null)
      setTxHash(null)
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
      }
    },
    [signer, connect],
  )

  return { run, pending, error, done, txHash, signedIn: !!signer }
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
  15: 'This VASP has been revoked and cannot be changed again',
  16: 'A reason is required to suspend or revoke a VASP',
  17: 'The reason is too long (256 bytes maximum)',
  18: 'One of the values is not valid, for example an expiry date that has already passed',
  19: 'There is no threshold set for that jurisdiction',
  20: 'That jurisdiction is not on the allowed list',
  21: 'A VASP needs a real jurisdiction; "*" and empty values are not allowed',
  22: 'The receiving VASP is still active, so this payment cannot be reclaimed early',
  23: 'The batch is larger than the contract allows',
  24: 'This payment would exceed the originator\'s escrow limit for this asset',
  25: 'The amount is below the minimum for this asset',
  26: 'The beneficiary has already acknowledged this attestation',
  27: 'The beneficiary must acknowledge the attestation before release',
  28: 'This payment already has an attestation and can no longer be cancelled',
  29: 'The token transfer failed. Check the sender balance and that the recipient can receive this asset (trustline)',
  30: 'This VASP already has the maximum number of open payments. Resolve some before submitting more',
  31: 'The open-payment limit must be at least 1',
  32: 'The token delivered less than the requested amount; fee-on-transfer tokens are not supported',
  33: 'This asset is not on the escrow allowlist',
  34: 'Payments and releases are paused by the admin',
  35: 'The payment TTL is outside the allowed range',
  36: 'This payment has expired and can no longer be attested or released; the originator can reclaim it',
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.match(/Error\(Contract, #(\d+)\)/)
  if (m && CONTRACT_ERRORS[Number(m[1])]) return CONTRACT_ERRORS[Number(m[1])]
  if (/not authorized|require_auth|InvalidAction/i.test(msg)) return 'Your wallet is not authorised for this action'
  if (/User declined|rejected/i.test(msg)) return 'Request cancelled in wallet'
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg
}

export function TxStatus({
  pending,
  error,
  done,
  txHash,
}: {
  pending: boolean
  error: string | null
  done: string | null
  /** Set when a transaction failed on-chain, so the user can inspect it. */
  txHash?: string | null
}) {
  if (pending) return <p className="text-sm text-muted-foreground">Waiting for wallet signature and confirmation…</p>
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
  if (done) return <p className="text-sm text-green-700">✓ {done}</p>
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
