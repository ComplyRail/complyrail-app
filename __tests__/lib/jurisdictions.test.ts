import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { JURISDICTIONS } from '@/lib/jurisdictions'

// The contract's allowlist lives in one Rust file; the UI must offer exactly those codes.
const rustSource = readFileSync(join(process.cwd(), 'contracts/complyrail/src/jurisdictions.rs'), 'utf8')
const allowedBlock = /ALLOWED:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]/.exec(rustSource)?.[1] ?? ''
const contractCodes = [...allowedBlock.matchAll(/"([^"]*)"/g)].map(m => m[1])

describe('jurisdiction allowlist', () => {
  it('UI list matches the contract allowlist', () => {
    expect(contractCodes.length).toBeGreaterThan(0)
    expect([...JURISDICTIONS].sort()).toEqual([...contractCodes].sort())
  })

  it('every code is uppercase and at most three characters', () => {
    for (const code of contractCodes) {
      expect(code).toBe(code.toUpperCase())
      expect(code.length).toBeLessThanOrEqual(3)
    }
  })
})
