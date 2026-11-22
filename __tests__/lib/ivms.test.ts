// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildIvmsPayload, sha256Hex } from '@/lib/contract'
import { canonicalJson, verifyIvmsPayload } from '@/lib/ivms'

const G1 = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

const payload = buildIvmsPayload({
  paymentId: '7', originatorName: 'Ada', originatorAccount: G1,
  beneficiaryName: 'Bola', beneficiaryAccount: G2, amount: '10', asset: 'USDC',
})

async function onChainHashFor(value: unknown) {
  return sha256Hex(canonicalJson(value))
}

describe('canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('keeps array order, since it is meaningful in IVMS101', () => {
    expect(canonicalJson({ list: [2, 1] })).toBe('{"list":[2,1]}')
  })

  it('produces the same string regardless of key order or whitespace', () => {
    const reordered = JSON.parse(
      '{\n  "transfer": {"asset":"USDC","amount":"10"},\n  "paymentId": "7",\n  "ivms101Version": "IVMS101.2023",\n' +
      '  "originator": { "accountNumber": ["' + G1 + '"], "originatorPersons": [{"naturalPerson":{"name":{"nameIdentifier":[{"primaryIdentifier":"Ada"}]}}}] },\n' +
      '  "beneficiary": {"beneficiaryPersons":[{"naturalPerson":{"name":{"nameIdentifier":[{"primaryIdentifier":"Bola"}]}}}],"accountNumber":["' + G2 + '"]}\n}',
    )
    expect(canonicalJson(reordered)).toBe(canonicalJson(payload))
  })
})

describe('verifyIvmsPayload', () => {
  it('reports a match when the pasted payload is the one that was hashed', async () => {
    const hash = await onChainHashFor(payload)
    const result = await verifyIvmsPayload(JSON.stringify(payload, null, 2), hash)
    expect(result.status).toBe('match')
  })

  it('does not report a mismatch for key-order or whitespace differences', async () => {
    const hash = await onChainHashFor(payload)
    const { transfer, ...rest } = payload
    const compact = JSON.stringify({ transfer, ...rest })
    expect((await verifyIvmsPayload(compact, hash)).status).toBe('match')
  })

  it('reports a mismatch when any field differs', async () => {
    const hash = await onChainHashFor(payload)
    const tampered = { ...payload, transfer: { ...payload.transfer, amount: '1000' } }
    const result = await verifyIvmsPayload(JSON.stringify(tampered), hash)
    expect(result.status).toBe('mismatch')
    if (result.status !== 'invalid') expect(result.computedHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('compares the on-chain hash case-insensitively and ignoring surrounding spaces', async () => {
    const hash = await onChainHashFor(payload)
    expect((await verifyIvmsPayload(JSON.stringify(payload), `  ${hash.toUpperCase()} `)).status).toBe('match')
  })

  it('reports invalid, not mismatch, for input that is not a JSON object', async () => {
    const hash = await onChainHashFor(payload)
    expect((await verifyIvmsPayload('{not json', hash)).status).toBe('invalid')
    expect((await verifyIvmsPayload('"just a string"', hash)).status).toBe('invalid')
    expect((await verifyIvmsPayload('null', hash)).status).toBe('invalid')
  })
})
