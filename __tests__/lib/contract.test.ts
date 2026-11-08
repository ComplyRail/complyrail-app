// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildIvmsPayload,
  mapEvent,
  mapPayment,
  mapVasp,
  sha256Hex,
  unwrap,
  vaspStatusArg,
  type RawPayment,
  type RawVasp,
} from '@/lib/contract'
import { PaymentStatus, VaspStatus } from '@/lib/types'

const G1 = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

describe('mapVasp', () => {
  const raw: RawVasp = {
    address: G1,
    name: 'Acme Exchange',
    jurisdiction: 'US',
    public_key: new Uint8Array(32).fill(0xab),
    status: { tag: 'Suspended' },
    added_at: 1_700_000_000n,
    expires_at: null,
  }

  it('converts contract fields to the app shape', () => {
    const v = mapVasp(raw)
    expect(v.status).toBe(VaspStatus.Suspended)
    expect(v.publicKey).toBe('ab'.repeat(32))
    expect(v.addedAt).toBe(1_700_000_000)
    expect(v.expiresAt).toBeUndefined()
  })

  it('keeps an expiry when set', () => {
    expect(mapVasp({ ...raw, expires_at: 1_800_000_000n }).expiresAt).toBe(1_800_000_000)
  })
})

describe('mapPayment', () => {
  const raw: RawPayment = {
    id: 7n,
    from_vasp: G1,
    to_vasp: G2,
    beneficiary: G2,
    asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    amount: 50_000_000_000n,
    status: { tag: 'Pending' },
    requires_attestation: true,
    attestation_hash: undefined,
    ivms_version: undefined,
    attested_at: undefined,
    created_at: 100n,
    expires_at: 700n,
    resolved_at: undefined,
  }

  it('maps a held payment without attestation', () => {
    const p = mapPayment(raw)
    expect(p.id).toBe('7')
    expect(p.amount).toBe('50000000000')
    expect(p.status).toBe(PaymentStatus.Pending)
    expect(p.requiresAttestation).toBe(true)
    expect(p.attestationHash).toBeUndefined()
    expect(p.expiresAt).toBe(700)
  })

  it('maps attestation and resolution fields', () => {
    const p = mapPayment({
      ...raw,
      status: { tag: 'Released' },
      attestation_hash: new Uint8Array(32).fill(1),
      ivms_version: 'IVMS101.2023',
      attested_at: 200n,
      resolved_at: 300n,
    })
    expect(p.status).toBe(PaymentStatus.Released)
    expect(p.attestationHash).toBe('01'.repeat(32))
    expect(p.ivmsVersion).toBe('IVMS101.2023')
    expect(p.resolvedAt).toBe(300)
  })
})

describe('mapEvent', () => {
  const base = { id: 'e1', ledger: 10, ledgerClosedAt: '2026-11-08T12:00:00Z', txHash: 'abcd' }

  it('maps a payment-submitted event and formats the amount', () => {
    const e = mapEvent({
      ...base,
      topics: ['pay_sub', 3n],
      data: { from_vasp: G1, to_vasp: G2, amount: 25_000_000n, requires_attestation: true },
    })
    expect(e).not.toBeNull()
    expect(e!.type).toBe('pay_sub')
    expect(e!.subject).toBe('3')
    expect(e!.details!.amount).toBe('2.5')
    expect(e!.details!.requires_attestation).toBe('true')
    expect(e!.timestamp).toBe(Date.parse('2026-11-08T12:00:00Z') / 1000)
  })

  it('renders enum values by tag', () => {
    const e = mapEvent({ ...base, topics: ['vasp_upd', G1], data: { status: { tag: 'Revoked' } } })
    expect(e!.details!.status).toBe('Revoked')
  })

  it('ignores events it does not know', () => {
    expect(mapEvent({ ...base, topics: ['transfer', G1], data: 1n })).toBeNull()
  })
})

describe('helpers', () => {
  it('builds tagged enum args for VaspStatus', () => {
    expect(vaspStatusArg(VaspStatus.Suspended)).toEqual({ tag: 'Suspended', values: undefined })
  })

  it('unwraps Result-like values and passes plain values through', () => {
    expect(unwrap({ unwrap: () => 5 })).toBe(5)
    expect(unwrap(5)).toBe(5)
    expect(() => unwrap({ unwrap: () => { throw new Error('boom') } })).toThrow('boom')
  })

  it('hashes the IVMS101 payload deterministically', async () => {
    const payload = buildIvmsPayload({
      paymentId: '1', originatorName: 'Ada', originatorAccount: G1,
      beneficiaryName: 'Bola', beneficiaryAccount: G2, amount: '10', asset: 'USDC',
    })
    expect(payload.originator.accountNumber).toEqual([G1])
    const a = await sha256Hex(JSON.stringify(payload))
    const b = await sha256Hex(JSON.stringify(payload))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
