// Sealed-box encryption for IVMS101 payloads. See docs/ivms-encryption.md.
//
// Scheme (X25519-HKDF-SHA256-AES256GCM):
//   1. Sender generates an ephemeral X25519 keypair.
//   2. shared = X25519(ephemeral private, recipient public)
//   3. key    = HKDF-SHA256(shared, salt = ephemeral public || recipient public, info = INFO)
//   4. ct     = AES-256-GCM(key, random 12-byte nonce, plaintext, aad = ephemeral public)
// The envelope carries the ephemeral public key, nonce and ciphertext. Only the
// holder of the recipient's private key can derive `key`.

import { bytesToHex, hexToBytes as hexToRawBytes } from './format'

// WebCrypto typings require ArrayBuffer-backed views, so copy into a concrete buffer.
const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array(hexToRawBytes(hex))

export const IVMS_ENVELOPE_ALG = 'x25519-hkdf-sha256-aes256gcm'

const HKDF_INFO = new Uint8Array(new TextEncoder().encode('complyrail/ivms101/v1'))
const NONCE_BYTES = 12

export interface IvmsEnvelope {
  v: 1
  alg: typeof IVMS_ENVELOPE_ALG
  /** ephemeral X25519 public key, hex */
  epk: string
  /** AES-GCM nonce, hex */
  nonce: string
  /** ciphertext including GCM tag, hex */
  ct: string
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function deriveAesKey(shared: ArrayBuffer, ephPub: Uint8Array, recipientPub: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(ephPub, recipientPub), info: HKDF_INFO },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function assertKeyLength(bytes: Uint8Array, label: string) {
  if (bytes.length !== 32) throw new Error(`${label} must be 32 bytes`)
}

/** Encrypts `plaintext` so only the holder of the matching X25519 private key can read it. */
export async function sealIvmsPayload(plaintext: string, recipientPublicKeyHex: string): Promise<string> {
  const recipientPub = hexToBytes(recipientPublicKeyHex)
  assertKeyLength(recipientPub, 'Recipient public key')

  const recipientKey = await crypto.subtle.importKey('raw', recipientPub, { name: 'X25519' }, false, [])
  const ephemeral = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: recipientKey }, ephemeral.privateKey, 256)
  const aesKey = await deriveAesKey(shared, ephPub, recipientPub)

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: ephPub },
      aesKey,
      new Uint8Array(new TextEncoder().encode(plaintext)),
    ),
  )

  const envelope: IvmsEnvelope = {
    v: 1,
    alg: IVMS_ENVELOPE_ALG,
    epk: bytesToHex(ephPub),
    nonce: bytesToHex(nonce),
    ct: bytesToHex(ct),
  }
  return JSON.stringify(envelope, null, 2)
}

/**
 * Decrypts an envelope produced by `sealIvmsPayload`. The recipient's public key
 * is required because WebCrypto imports X25519 private keys as JWK with both halves.
 */
export async function openIvmsPayload(
  envelopeJson: string,
  privateKeyHex: string,
  recipientPublicKeyHex: string,
): Promise<string> {
  let env: IvmsEnvelope
  try {
    env = JSON.parse(envelopeJson) as IvmsEnvelope
  } catch {
    throw new Error('Envelope is not valid JSON')
  }
  if (env.v !== 1 || env.alg !== IVMS_ENVELOPE_ALG) throw new Error('Unsupported envelope version or algorithm')

  const priv = hexToBytes(privateKeyHex)
  const recipientPub = hexToBytes(recipientPublicKeyHex)
  assertKeyLength(priv, 'Private key')
  assertKeyLength(recipientPub, 'Recipient public key')
  const ephPub = hexToBytes(env.epk)
  assertKeyLength(ephPub, 'Ephemeral public key')

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'X25519', x: toBase64Url(recipientPub), d: toBase64Url(priv) },
    { name: 'X25519' },
    false,
    ['deriveBits'],
  )
  const ephKey = await crypto.subtle.importKey('raw', ephPub, { name: 'X25519' }, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: ephKey }, privateKey, 256)
  const aesKey = await deriveAesKey(shared, ephPub, recipientPub)

  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(env.nonce), additionalData: ephPub },
      aesKey,
      hexToBytes(env.ct),
    )
    return new TextDecoder().decode(pt)
  } catch {
    throw new Error('Decryption failed: wrong key or the payload was altered')
  }
}
