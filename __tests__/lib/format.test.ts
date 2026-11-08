// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { bytesToHex, formatAddress, formatHash, fromUnits, hexToBytes, toUnits } from '@/lib/format'

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
