export interface ConnectedWallet {
  publicKey: string
  walletName?: string
}

export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015'

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address)
}

export function getWalletKit() {
  // StellarWalletsKit will be integrated in Phase 4.5
  // For now, return a placeholder
  return null
}
