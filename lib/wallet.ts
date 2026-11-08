export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015'

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address)
}
