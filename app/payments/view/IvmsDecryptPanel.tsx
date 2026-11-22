'use client'

import { useState } from 'react'
import { sha256Hex } from '@/lib/contract'
import { openIvmsPayload } from '@/lib/ivms-crypto'

/**
 * Beneficiary-side view: decrypts an envelope with the VASP's private key, which is
 * used in the browser only and never stored or sent anywhere. The result is checked
 * against the attestation hash recorded on-chain.
 */
export function IvmsDecryptPanel({
  recipientPublicKey,
  attestationHash,
}: {
  recipientPublicKey: string
  attestationHash: string
}) {
  const [envelope, setEnvelope] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [hashMatches, setHashMatches] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const decrypt = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setPlaintext(null)
    setHashMatches(null)
    try {
      const text = await openIvmsPayload(envelope.trim(), privateKey.trim(), recipientPublicKey)
      setHashMatches((await sha256Hex(text)) === attestationHash)
      setPlaintext(JSON.stringify(JSON.parse(text), null, 2))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setPrivateKey('')
    }
  }

  return (
    <form onSubmit={decrypt} className="bg-card border border-border rounded-lg p-6 mb-6 space-y-4">
      <h2 className="text-lg font-semibold">Decrypt IVMS101 payload</h2>
      <p className="text-sm text-muted-foreground">
        Paste the encrypted payload from the originating VASP and your VASP&apos;s X25519 private key. Decryption runs
        in this browser; the key is not stored.
      </p>
      <textarea required rows={6} placeholder="Encrypted payload (JSON envelope)" value={envelope}
        onChange={e => setEnvelope(e.target.value)}
        className="w-full px-3 py-2 border border-border rounded bg-background font-mono text-xs" />
      <input required type="password" autoComplete="off" placeholder="Your private key (64 hex characters)"
        value={privateKey} onChange={e => setPrivateKey(e.target.value)}
        className="w-full px-3 py-2 border border-border rounded bg-background font-mono text-xs" />
      <button type="submit" disabled={busy}
        className="w-full px-4 py-2 rounded bg-blue-600 text-white hover:opacity-90 disabled:opacity-50">
        {busy ? 'Decrypting…' : 'Decrypt'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {plaintext && (
        <div className="text-sm space-y-2">
          <p className={hashMatches ? 'text-green-700' : 'text-red-600'}>
            {hashMatches
              ? 'Matches the attestation hash recorded on-chain.'
              : 'Does NOT match the attestation hash recorded on-chain. Do not release this payment.'}
          </p>
          <pre className="p-3 bg-muted rounded overflow-x-auto text-xs">{plaintext}</pre>
        </div>
      )}
    </form>
  )
}
