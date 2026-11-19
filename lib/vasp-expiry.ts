/** Registrations expiring within this many days are highlighted in the VASP table. */
export const EXPIRY_WARNING_DAYS = 14

const SECONDS_PER_DAY = 86400

export type ExpiryState =
  | { kind: 'none' }
  | { kind: 'expired' }
  | { kind: 'expiring-soon'; daysLeft: number }
  | { kind: 'active'; daysLeft: number }

/** Classifies a unix-seconds expiry relative to `nowSeconds`. */
export function expiryState(expiresAt: number | undefined | null, nowSeconds: number): ExpiryState {
  if (!expiresAt) return { kind: 'none' }
  if (nowSeconds >= expiresAt) return { kind: 'expired' }
  const daysLeft = Math.ceil((expiresAt - nowSeconds) / SECONDS_PER_DAY)
  return daysLeft <= EXPIRY_WARNING_DAYS ? { kind: 'expiring-soon', daysLeft } : { kind: 'active', daysLeft }
}

/**
 * Parses a "+N days" input into the unix-seconds expiry to write on-chain.
 * Returns null for anything that is not a whole number of days >= 1.
 */
export function expiryFromDays(input: string, nowSeconds: number): number | null {
  const trimmed = input.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const days = Number(trimmed)
  if (days < 1) return null
  return Math.floor(nowSeconds) + days * SECONDS_PER_DAY
}
