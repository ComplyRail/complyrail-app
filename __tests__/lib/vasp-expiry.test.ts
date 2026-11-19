import { describe, it, expect } from 'vitest'
import { EXPIRY_WARNING_DAYS, expiryFromDays, expiryState } from '@/lib/vasp-expiry'

const NOW = 1_800_000_000
const DAY = 86400

describe('expiryState', () => {
  it('returns none when there is no expiry', () => {
    expect(expiryState(undefined, NOW)).toEqual({ kind: 'none' })
    expect(expiryState(0, NOW)).toEqual({ kind: 'none' })
  })

  it('returns expired at and after the expiry instant', () => {
    expect(expiryState(NOW, NOW)).toEqual({ kind: 'expired' })
    expect(expiryState(NOW - 1, NOW)).toEqual({ kind: 'expired' })
  })

  it('flags registrations expiring within 14 days', () => {
    expect(EXPIRY_WARNING_DAYS).toBe(14)
    expect(expiryState(NOW + 14 * DAY, NOW)).toEqual({ kind: 'expiring-soon', daysLeft: 14 })
    expect(expiryState(NOW + DAY, NOW)).toEqual({ kind: 'expiring-soon', daysLeft: 1 })
  })

  it('treats anything beyond 14 days as active', () => {
    expect(expiryState(NOW + 15 * DAY, NOW)).toEqual({ kind: 'active', daysLeft: 15 })
  })

  it('rounds partial days up so a registration with 2 hours left shows 1 day', () => {
    expect(expiryState(NOW + 2 * 3600, NOW)).toEqual({ kind: 'expiring-soon', daysLeft: 1 })
  })
})

describe('expiryFromDays', () => {
  it('converts a whole number of days into an absolute unix timestamp', () => {
    expect(expiryFromDays('30', NOW)).toBe(NOW + 30 * DAY)
    expect(expiryFromDays(' 7 ', NOW)).toBe(NOW + 7 * DAY)
  })

  it('rejects zero, negatives, decimals and non-numeric input', () => {
    expect(expiryFromDays('0', NOW)).toBeNull()
    expect(expiryFromDays('-3', NOW)).toBeNull()
    expect(expiryFromDays('1.5', NOW)).toBeNull()
    expect(expiryFromDays('', NOW)).toBeNull()
    expect(expiryFromDays('abc', NOW)).toBeNull()
  })

  it('can shorten as well as extend, because it is measured from now', () => {
    const current = NOW + 90 * DAY
    expect(expiryFromDays('10', NOW)).toBeLessThan(current)
    expect(expiryFromDays('365', NOW)).toBeGreaterThan(current)
  })
})
