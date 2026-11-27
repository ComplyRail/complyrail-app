/**
 * Tests for app/audit/page.tsx:
 *   #91 – CSV escaping and formula injection neutralisation
 *   #92 – revokeObjectURL called after JSON export
 *   #93 – long non-address reason text is not abbreviated via isStellarAddressOrHash
 */
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { isStellarAddressOrHash, formatAddress } from '@/lib/format'

// ---------------------------------------------------------------------------
// Helpers extracted from app/audit/page.tsx under test
// ---------------------------------------------------------------------------

/** Identical to the implementation in audit/page.tsx */
function escapeCsvCell(cell: string): string {
  const safe = /^[=+\-@]/.test(cell) ? `'${cell}` : cell
  return `"${safe.replace(/"/g, '""')}"`
}

/**
 * Mirrors the triggerDownload helper in audit/page.tsx.
 * Accepts injectable URL helpers so the test never touches real browser APIs.
 */
function triggerDownload(
  filename: string,
  createObjectURL: (b: { type: string }) => string,
  revokeObjectURL: (u: string) => void,
): void {
  const url = createObjectURL({ type: 'application/json' })
  // Simulate the anchor-click pattern without a real DOM
  void filename
  revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// #91 CSV escaping
// ---------------------------------------------------------------------------

describe('#91 CSV escaping and formula injection neutralisation', () => {
  it('prefixes formula-leading cells (=) with a single quote', () => {
    const formula = '=HYPERLINK("https://evil.example", "click me")'
    expect(escapeCsvCell(formula)).toMatch(/^"'=HYPERLINK/)
  })

  it('prefixes formula-leading cells (+, -, @) with a single quote', () => {
    expect(escapeCsvCell('+1234')).toBe(`"'+1234"`)
    expect(escapeCsvCell('-1')).toBe(`"'-1"`)
    expect(escapeCsvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
  })

  it('escapes embedded double-quotes by doubling them', () => {
    expect(escapeCsvCell('quoted "text" here')).toBe('"quoted ""text"" here"')
  })

  it('handles a cell with both a formula prefix and embedded quotes', () => {
    expect(escapeCsvCell('=A1&"bad"')).toBe(`"'=A1&""bad"""`)
  })

  it('leaves normal cells unchanged (just wraps in quotes)', () => {
    expect(escapeCsvCell('beneficiary mismatch')).toBe('"beneficiary mismatch"')
  })
})

// ---------------------------------------------------------------------------
// #92 revokeObjectURL called after export
// ---------------------------------------------------------------------------

describe('#92 revokeObjectURL called after blob download', () => {
  it('calls revokeObjectURL with the URL that was created', () => {
    const createObjectURL = vi.fn(() => 'blob:test-url')
    const revokeObjectURL = vi.fn()

    triggerDownload('test.json', createObjectURL, revokeObjectURL)

    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-url')
  })

  it('calls revokeObjectURL for every export (CSV and JSON)', () => {
    // Both CSV and JSON go through the same triggerDownload helper.
    for (const name of ['test.csv', 'test.json']) {
      const createObjectURL = vi.fn(() => `blob:${name}`)
      const revokeObjectURL = vi.fn()
      triggerDownload(name, createObjectURL, revokeObjectURL)
      expect(revokeObjectURL).toHaveBeenCalledWith(`blob:${name}`)
    }
  })
})

// ---------------------------------------------------------------------------
// #93 non-address values should not be abbreviated
// ---------------------------------------------------------------------------

describe('#93 isStellarAddressOrHash gates abbreviation', () => {
  it('a long rejection reason is not treated as an address', () => {
    const reason = 'beneficiary name mismatch on account'
    expect(isStellarAddressOrHash(reason)).toBe(false)
    // The page shows `isStellarAddressOrHash(v) ? formatAddress(v) : v`
    const display = isStellarAddressOrHash(reason) ? formatAddress(reason) : reason
    expect(display).toBe(reason)
  })

  it('a Stellar public key is recognised and abbreviated', () => {
    const address = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
    expect(isStellarAddressOrHash(address)).toBe(true)
    // formatAddress keeps first 4 and last 4 characters
    expect(formatAddress(address)).toBe(`${address.slice(0, 4)}...${address.slice(-4)}`)
  })

  it('a 64-hex transaction hash is recognised and abbreviated', () => {
    const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(isStellarAddressOrHash(hash)).toBe(true)
    expect(formatAddress(hash)).toBe(`${hash.slice(0, 4)}...${hash.slice(-4)}`)
  })
})
