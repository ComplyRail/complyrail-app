// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildIvmsPayload, canonicalJson, sha256Hex } from '@/lib/contract'

const G1 = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

describe('canonicalJson (RFC 8785)', () => {
  it('sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe('{"a":{"c":null,"d":true},"b":1}')
  })

  it('formats numbers as ES Number strings', () => {
    expect(canonicalJson([333333333.33333329, 1e30, 4.5, 2e-3, 1e-27, -0])).toBe(
      '[333333333.3333333,1e+30,4.5,0.002,1e-27,0]',
    )
  })

  it('escapes strings the RFC 8785 way', () => {
    expect(canonicalJson('€$\u000f\nA\'B"\\/')).toBe('"€$\\u000f\\nA\'B\\"\\\\/"')
  })

  it('matches the RFC 8785 appendix sample', () => {
    const rfc = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: '\u20ac$\u000f\nA\'B"\\"/',
      literals: [null, true, false],
    }
    expect(canonicalJson(rfc)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\"/"}',
    )
  })

  it('rejects values JSON cannot represent', () => {
    expect(() => canonicalJson(NaN)).toThrow()
    expect(() => canonicalJson(Infinity)).toThrow()
    expect(() => canonicalJson(1n)).toThrow()
  })

  it('matches the published IVMS101 vector in docs/ivms-hashing.md', async () => {
    const payload = buildIvmsPayload({
      paymentId: '1', originatorName: 'Ada', originatorAccount: G1,
      beneficiaryName: 'Bola', beneficiaryAccount: G2, amount: '10', asset: 'USDC',
    })
    expect(await sha256Hex(canonicalJson(payload))).toBe(
      'be84610f178ff28ed14d8ae5842355631d1192157edc96447a91854028abea44',
    )
  })

  it('produces the same IVMS101 vector regardless of key order', async () => {
    const payload = buildIvmsPayload({
      paymentId: '1', originatorName: 'Ada', originatorAccount: G1,
      beneficiaryName: 'Bola', beneficiaryAccount: G2, amount: '10', asset: 'USDC',
    })
    const reordered = Object.fromEntries(Object.entries(payload).reverse())
    expect(canonicalJson(reordered)).toBe(canonicalJson(payload))
    expect(await sha256Hex(canonicalJson(reordered))).toBe(await sha256Hex(canonicalJson(payload)))
  })
})
