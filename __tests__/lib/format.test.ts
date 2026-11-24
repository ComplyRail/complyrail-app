// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  bytesToHex,
  exceedsBalance,
  formatAddress,
  formatHash,
  fromUnits,
  hexToBytes,
  MAX_I128,
  parseVaspKey,
  toUnits,
  truncateMiddle,
  vaspKeyError,
} from '@/lib/format'

describe('toUnits', () => {
  it('converts whole and fractional amounts to 7-decimal units', () => {
    expect(toUnits('1')).toBe(10_000_000n)
    expect(toUnits('12.5')).toBe(125_000_000n)
    expect(toUnits('0.0000001')).toBe(1n)
    expect(toUnits(' 3 ')).toBe(30_000_000n)
  })

  it('rejects invalid or over-precise input instead of rounding', () => {
    expect(() => toUnits('abc')).toThrow()
    expect(() => toUnits('-1')).toThrow()
    expect(() => toUnits('1.')).toThrow()
    expect(() => toUnits('0.00000001')).toThrow(/decimal places/)
  })
})

describe('fromUnits', () => {
  it('formats units back to human amounts', () => {
    expect(fromUnits(10_000_000n)).toBe('1')
    expect(fromUnits('125000000')).toBe('12.5')
    expect(fromUnits(1n)).toBe('0.0000001')
    expect(fromUnits(12_345_678_900_000n)).toBe('1,234,567.89')
  })

  it('round-trips with toUnits', () => {
    for (const v of ['0.1', '42', '999.9999999']) {
      expect(fromUnits(toUnits(v)).replace(/,/g, '')).toBe(v)
    }
  })
})

describe('hex helpers', () => {
  it('round-trips bytes and hex', () => {
    const bytes = new Uint8Array([0, 1, 171, 255])
    expect(bytesToHex(bytes)).toBe('0001abff')
    expect(Array.from(hexToBytes('0001abff'))).toEqual([0, 1, 171, 255])
  })

  it('rejects malformed hex', () => {
    expect(() => hexToBytes('abc')).toThrow()
    expect(() => hexToBytes('zz')).toThrow()
  })
})

describe('display helpers', () => {
  it('shortens addresses and hashes', () => {
    expect(formatAddress('GABCDEFGHIJKLMNOP')).toBe('GABC...MNOP')
    expect(formatAddress('short')).toBe('short')
    expect(formatHash('0123456789abcdef0123')).toBe('012345...ef0123')
  })
})

describe('VASP key validation', () => {
  it('accepts exactly 64 hex characters', () => {
    expect(vaspKeyError('ab'.repeat(32))).toBeNull()
    expect(parseVaspKey('ab'.repeat(32))).toEqual(new Uint8Array(32).fill(0xab))
  })

  it('rejects an empty key', () => {
    expect(vaspKeyError('')).toMatch(/required/)
    expect(() => parseVaspKey('')).toThrow(/required/)
  })

  it('rejects short and long keys with the length in the message', () => {
    expect(vaspKeyError('ab'.repeat(31))).toMatch(/64 hex characters \(got 62\)/)
    expect(() => parseVaspKey('ab'.repeat(33))).toThrow(/got 66/)
  })

  it('rejects non-hex characters of the right length', () => {
    expect(vaspKeyError('zz'.repeat(32))).not.toBeNull()
  })
})

describe('toUnits i128 bound', () => {
  const toHuman = (units: bigint) =>
    `${units / 10n ** 7n}.${(units % 10n ** 7n).toString().padStart(7, '0')}`

  it('accepts the largest amount that fits in i128', () => {
    expect(toUnits(toHuman(MAX_I128))).toBe(MAX_I128)
  })

  it('rejects one unit above the i128 maximum', () => {
    expect(() => toUnits(toHuman(MAX_I128 + 1n))).toThrow(/too large/)
  })

  it('rejects amounts far above the i128 maximum', () => {
    expect(() => toUnits('1' + '0'.repeat(40))).toThrow(/too large/)
  })
})

describe('truncateMiddle', () => {
  it('keeps both ends of a long key', () => {
    expect(truncateMiddle('0123456789abcdef'.repeat(4))).toBe('01234567…89abcdef')
  })

  it('leaves short values and empty strings alone', () => {
    expect(truncateMiddle('short')).toBe('short')
    expect(truncateMiddle('')).toBe('')
  })
})

describe('exceedsBalance', () => {
  it('flags an amount larger than the balance', () => {
    expect(exceedsBalance(10_000_001n, 10_000_000n)).toBe(true)
  })

  it('allows an amount equal to or below the balance', () => {
    expect(exceedsBalance(10_000_000n, 10_000_000n)).toBe(false)
    expect(exceedsBalance(1n, 10_000_000n)).toBe(false)
  })

  it('does not block while the balance is still unknown', () => {
    expect(exceedsBalance(10n ** 18n, null)).toBe(false)
  })
})
