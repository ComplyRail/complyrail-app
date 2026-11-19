/**
 * Maximum byte lengths for free-text fields. These mirror the constants in
 * contracts/complyrail/src/lib.rs (MAX_*_LEN); the contract is the source of
 * truth, this module only lets the dashboard reject input before signing.
 */
export const FIELD_LIMITS = {
  name: 128,
  jurisdiction: 8,
  ivmsVersion: 32,
  reason: 256,
} as const

/** On-chain length is measured in UTF-8 bytes, not characters. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Returns an error message if `value` exceeds `max` bytes, otherwise null. */
export function lengthError(label: string, value: string, max: number): string | null {
  return byteLength(value) > max ? `${label} must be at most ${max} bytes` : null
}
