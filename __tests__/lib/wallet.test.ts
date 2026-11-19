// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isValidStellarAddress } from '@/lib/wallet'

const VALID = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'

/** Replaces one character with a different base32 character, keeping length and prefix. */
function withTypo(address: string, index: number): string {
  const replacement = address[index] === 'A' ? 'B' : 'A'
  return address.slice(0, index) + replacement + address.slice(index + 1)
}

describe('isValidStellarAddress', () => {
  it('accepts a valid account address', () => {
    expect(isValidStellarAddress(VALID)).toBe(true)
  })

  it('rejects an address with one character changed', () => {
    const typo = withTypo(VALID, 20)
    expect(typo).toHaveLength(VALID.length)
    expect(typo.startsWith('G')).toBe(true)
    expect(isValidStellarAddress(typo)).toBe(false)
  })

  it('rejects a typo in the last character', () => {
    expect(isValidStellarAddress(withTypo(VALID, VALID.length - 1))).toBe(false)
  })

  it('rejects the wrong length or prefix', () => {
    expect(isValidStellarAddress(VALID.slice(0, -1))).toBe(false)
    expect(isValidStellarAddress('S' + VALID.slice(1))).toBe(false)
    expect(isValidStellarAddress('')).toBe(false)
  })
})
