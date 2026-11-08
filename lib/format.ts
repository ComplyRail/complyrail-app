import { ASSET_DECIMALS } from './config'

export function formatAddress(address: string): string {
  if (!address || address.length < 8) return address
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

export function formatHash(hash: string): string {
  if (!hash || hash.length < 12) return hash
  return `${hash.slice(0, 6)}...${hash.slice(-6)}`
}

/**
 * Convert a human amount ("12.5") to the contract's integer units
 * (stroops, 7 decimals). Throws on invalid input instead of rounding.
 */
export function toUnits(amount: string, decimals = ASSET_DECIMALS): bigint {
  const trimmed = amount.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid amount: "${amount}"`)
  const [whole, frac = ''] = trimmed.split('.')
  if (frac.length > decimals) throw new Error(`Too many decimal places (max ${decimals})`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

/** Convert integer units back to a human string, trimming trailing zeros. */
export function fromUnits(units: bigint | string, decimals = ASSET_DECIMALS): string {
  const v = BigInt(units)
  const neg = v < 0n
  const abs = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) throw new Error('Invalid hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
