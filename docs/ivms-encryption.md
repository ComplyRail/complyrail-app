# IVMS101 payload encryption

The full IVMS101 payload is exchanged off-chain. Only its SHA-256 hash is stored on-chain
(`submit_attestation`). This document describes how the payload is encrypted for the
receiving VASP, so that only that VASP can read it.

## Keys

- Each VASP registers a 32-byte X25519 public key (`VaspEntry.publicKey`, hex).
- The VASP keeps the matching private key. The dashboard never stores it.

## Scheme: `x25519-hkdf-sha256-aes256gcm`

Sealed-box style, using WebCrypto primitives only:

1. The sender generates an ephemeral X25519 keypair.
2. `shared = X25519(ephemeral_private, recipient_public)`.
3. `key = HKDF-SHA256(ikm = shared, salt = ephemeral_public || recipient_public, info = "complyrail/ivms101/v1", length = 32)`.
4. `ct = AES-256-GCM(key, nonce = 12 random bytes, plaintext = payload JSON, aad = ephemeral_public)`.

The envelope is JSON:

```json
{
  "v": 1,
  "alg": "x25519-hkdf-sha256-aes256gcm",
  "epk": "<hex, 32 bytes>",
  "nonce": "<hex, 12 bytes>",
  "ct": "<hex, ciphertext || 16-byte GCM tag>"
}
```

A new ephemeral key and nonce are used for every payload.

## Hash binding

The on-chain attestation hash is `sha256(payload JSON)` of the **plaintext** payload, as before.
After decrypting, the beneficiary recomputes the hash and compares it with the on-chain value
(the decrypt panel does this). A mismatch means the payload is not the one that was attested.

## Flow

1. Originator fills in the attestation form. The browser builds the payload, hashes it, and
   seals it to `VaspEntry.publicKey` of the receiving VASP.
2. The originator submits the hash on-chain and downloads the envelope.
3. The envelope is sent to the receiving VASP over the Travel Rule channel.
4. The receiving VASP pastes the envelope and its private key into the decrypt panel. Decryption
   runs in the browser; the key is cleared from the form after each attempt.

## Browser support

Requires WebCrypto X25519 (`generateKey`, `deriveBits`, JWK import). Current Chromium, Firefox
and Safari versions support it. Older browsers will fail at seal or open time with an error.

## Limitations

- The payload hash is not keyed, so anyone who can guess the full payload can confirm a guess.
  The payload is encrypted, so this requires access to the envelope.
- The scheme gives confidentiality and integrity for the envelope. It does not authenticate the
  sender. The on-chain attestation, made from the originating VASP's Stellar account, provides
  that link.
- Key rotation is not handled. A VASP that re-registers a new key cannot open older envelopes
  unless it keeps the old private key.
