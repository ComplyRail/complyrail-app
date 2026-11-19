// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { openIvmsPayload, sealIvmsPayload, IVMS_ENVELOPE_ALG } from '@/lib/ivms-crypto'

async function x25519Keypair() {
  const kp = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('hex')
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  const priv = Buffer.from(jwk.d!, 'base64url').toString('hex')
  return { pub, priv }
}

const PAYLOAD = JSON.stringify({ paymentId: '7', originator: { accountNumber: ['CUST-1'] } })

describe('IVMS payload sealing', () => {
  it('round-trips the payload for the intended recipient', async () => {
    const bob = await x25519Keypair()
    const envelope = await sealIvmsPayload(PAYLOAD, bob.pub)
    expect(await openIvmsPayload(envelope, bob.priv, bob.pub)).toBe(PAYLOAD)
  })

  it('does not leak the plaintext into the envelope', async () => {
    const bob = await x25519Keypair()
    const envelope = await sealIvmsPayload(PAYLOAD, bob.pub)
    expect(envelope).not.toContain('CUST-1')
    expect(JSON.parse(envelope).alg).toBe(IVMS_ENVELOPE_ALG)
  })

  it('uses a fresh ephemeral key and nonce on every seal', async () => {
    const bob = await x25519Keypair()
    const a = JSON.parse(await sealIvmsPayload(PAYLOAD, bob.pub))
    const b = JSON.parse(await sealIvmsPayload(PAYLOAD, bob.pub))
    expect(a.epk).not.toBe(b.epk)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ct).not.toBe(b.ct)
  })

  it('refuses to decrypt with a different recipient key', async () => {
    const bob = await x25519Keypair()
    const eve = await x25519Keypair()
    const envelope = await sealIvmsPayload(PAYLOAD, bob.pub)
    await expect(openIvmsPayload(envelope, eve.priv, eve.pub)).rejects.toThrow('Decryption failed')
  })

  it('detects a tampered ciphertext', async () => {
    const bob = await x25519Keypair()
    const env = JSON.parse(await sealIvmsPayload(PAYLOAD, bob.pub))
    env.ct = (env.ct[0] === '0' ? '1' : '0') + env.ct.slice(1)
    await expect(openIvmsPayload(JSON.stringify(env), bob.priv, bob.pub)).rejects.toThrow('Decryption failed')
  })

  it('rejects a recipient key that is not 32 bytes', async () => {
    await expect(sealIvmsPayload(PAYLOAD, 'abcd')).rejects.toThrow('must be 32 bytes')
  })
})
