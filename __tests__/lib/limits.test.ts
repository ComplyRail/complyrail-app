// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { FIELD_LIMITS, byteLength, lengthError } from '@/lib/limits'

describe('byteLength', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('é')).toBe(2)
  })
})

describe('lengthError', () => {
  it('accepts a value exactly at the limit', () => {
    expect(lengthError('Name', 'a'.repeat(FIELD_LIMITS.name), FIELD_LIMITS.name)).toBeNull()
  })

  it('rejects a value one byte over the limit', () => {
    expect(lengthError('Name', 'a'.repeat(FIELD_LIMITS.name + 1), FIELD_LIMITS.name)).toBe(
      'Name must be at most 128 bytes',
    )
  })

  it('counts multi-byte characters against the limit', () => {
    // 4 chars × 2 bytes = 8 bytes: fits jurisdiction limit exactly
    expect(lengthError('Jurisdiction', 'éééé', FIELD_LIMITS.jurisdiction)).toBeNull()
    expect(lengthError('Jurisdiction', 'ééééé', FIELD_LIMITS.jurisdiction)).not.toBeNull()
  })
})
