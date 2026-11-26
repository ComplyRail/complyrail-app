
import { StrKey, TransactionBuilder } from '@stellar/stellar-sdk'

export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015'

/**
 * True for a valid Stellar account address (G…).
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address)
}

/**
 * Reject a signed transaction if its source differs from the connected wallet.
 */
export function assertSignedTransactionSource(
  signedTxXdr: string,
  expectedAddress: string,
  networkPassphrase: string,
): void {
  const transaction = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase)

  const source =
    'innerTransaction' in transaction
      ? transaction.innerTransaction.source
      : transaction.source

  if (source !== expectedAddress) {
    throw new Error('Signed transaction source does not match the connected wallet.')
  }
}
