import { StrKey } from '@stellar/stellar-sdk'

export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015'

/**
 * True for a valid Stellar account address (G…). Checks the CRC16 checksum,
 * so a mistyped character is rejected even when the prefix and length match.
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address)
}
