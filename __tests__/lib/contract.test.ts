// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  buildIvmsPayload,
  externalRefArg,
  groupThresholds,
  mapEvent,
  mapPayment,
  mapThresholds,
  mapVasp,
  pageBounds,
  PAYMENT_PAGE_SIZE,
  sha256Hex,
  unwrap,
  vaspStatusArg,
  type RawPayment,
  type RawVasp,
} from '@/lib/contract'
import { IVMS101_VERSION, PaymentStatus, VaspStatus } from '@/lib/types'

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
    created_ledger: 42,
    expires_at: 700n,
    resolved_at: undefined,
    resolved_ledger: undefined,
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

  it('maps the external reference as hex, or leaves it undefined', () => {
    expect(mapPayment(raw).externalRef).toBeUndefined()
    const ref = new Uint8Array(32).fill(0xee)
    expect(mapPayment({ ...raw, external_ref: ref }).externalRef).toBe('ee'.repeat(32))
  })

  it('maps attestation and resolution fields', () => {
    const p = mapPayment({
      ...raw,
      status: { tag: 'Released' },
      attestation_hash: new Uint8Array(32).fill(1),
      ivms_version: 'IVMS101.2023',
      attested_at: 200n,
      resolved_at: 300n,
      resolved_ledger: 77,
    })
    expect(p.status).toBe(PaymentStatus.Released)
    expect(p.attestationHash).toBe('01'.repeat(32))
    expect(p.ivmsVersion).toBe('IVMS101.2023')
    expect(p.resolvedAt).toBe(300)
    expect(p.resolvedLedger).toBe(77)
  })

  it('maps created and resolved ledger sequences', () => {
    const p = mapPayment(raw)
    expect(p.createdLedger).toBe(42)
    expect(p.resolvedLedger).toBeUndefined()
  })
})

describe('pageBounds', () => {
  it('takes a full page below the cursor', () => {
    expect(pageBounds(120)).toEqual({ start: 120 - PAYMENT_PAGE_SIZE, limit: PAYMENT_PAGE_SIZE })
  })

  it('shrinks the last page to what is left', () => {
    expect(pageBounds(30)).toEqual({ start: 0, limit: 30 })
  })

  it('is empty once the cursor reaches zero', () => {
    expect(pageBounds(0)).toEqual({ start: 0, limit: 0 })
  })
})

describe('mapThresholds', () => {
  it('converts tuples to rows, keeps unlisted jurisdictions and drops zero amounts', () => {
    const rows = mapThresholds([
      [G1, 'US', 3_000n],
      [G1, '*', 0n],
      [G2, 'GB', '250'],
      [G2, 'BR', 400n],
    ])
    expect(rows).toEqual([
      { asset: G1, jurisdiction: 'US', amount: 3_000n },
      { asset: G2, jurisdiction: 'GB', amount: 250n },
      { asset: G2, jurisdiction: 'BR', amount: 400n },
    ])
  })

  it('returns an empty list when nothing is configured', () => {
    expect(mapThresholds([])).toEqual([])
  })
})

describe('groupThresholds', () => {
  it('puts a rule for an unlisted jurisdiction in the other group', () => {
    const us = { asset: G1, jurisdiction: 'US', amount: 3_000n }
    const fallback = { asset: G1, jurisdiction: '*', amount: 100n }
    const br = { asset: G2, jurisdiction: 'BR', amount: 400n }

    expect(groupThresholds([us, fallback, br])).toEqual({
      configured: [us, fallback],
      other: [br],
    })
  })

  it('matches configured codes case-insensitively and keeps unknown codes visible', () => {
    const lower = { asset: 'CUNKNOWN', jurisdiction: 'us', amount: 1n }
    const unknown = { asset: G2, jurisdiction: 'ZZ', amount: 2n }

    expect(groupThresholds([lower, unknown])).toEqual({
      configured: [lower],
      other: [unknown],
    })
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

  it('keeps ledger sequences in audit details', () => {
    const sub = mapEvent({
      ...base,
      topics: ['pay_sub', 3n],
      data: { from_vasp: G1, to_vasp: G2, amount: 1n, requires_attestation: true, created_ledger: 42 },
    })
    expect(sub!.details!.created_ledger).toBe('42')
    const rel = mapEvent({ ...base, topics: ['pay_rel', 3n], data: { amount: 1n, resolved_ledger: 77 } })
    expect(rel!.details!.resolved_ledger).toBe('77')
  })

  it('renders enum values by tag', () => {
    const e = mapEvent({ ...base, topics: ['vasp_upd', G1], data: { status: { tag: 'Revoked' } } })
    expect(e!.details!.status).toBe('Revoked')
  })

  it('maps an admin change with its own audit type and both admins', () => {
    const e = mapEvent({ ...base, topics: ['admin_chg', G2], data: { old_admin: G1 } })
    expect(e!.type).toBe('admin_chg')
    expect(e!.description).toBe('Admin transferred')
    expect(e!.subject).toBe(G2)
    expect(e!.details!.old_admin).toBe(G1)
  })

  it('labels a reclaim as reclaimed, not rejected', () => {
    const e = mapEvent({
      ...base,
      topics: ['pay_recl', 4n],
      data: { id: 4n, amount: 30_000_000n },
    })
    expect(e!.type).toBe('pay_recl')
    expect(e!.description).toBe('Payment reclaimed')
    expect(e!.subject).toBe('4')
    expect(e!.details!.amount).toBe('3')
  })

  it('formats threshold set details for first set and update', () => {
    const first = mapEvent({
      ...base,
      topics: ['thr_set', G1],
      data: { jurisdiction: 'GB', previous: undefined, amount: 50_000_000n, removed: false },
    })
    expect(first!.type).toBe('thr_set')
    expect(first!.details!.amount).toBe('5')
    expect(first!.details!.previous).toBeUndefined()

    const updated = mapEvent({
      ...base,
      topics: ['thr_set', G1],
      data: { jurisdiction: 'GB', previous: 25_000_000n, amount: 50_000_000n, removed: false },
    })
    expect(updated!.details!.previous).toBe('2.5')
    expect(updated!.details!.amount).toBe('5')
  })

  it('ignores events it does not know', () => {
    expect(mapEvent({ ...base, topics: ['transfer', G1], data: 1n })).toBeNull()
  })

  it('drops inherited object keys such as toString, constructor and __proto__', () => {
    for (const topic of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(mapEvent({ ...base, topics: [topic, G1], data: 1n })).toBeNull()
    }
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

  it('uses the customer account as originator accountNumber, not the VASP address', () => {
    const customer = 'CUST-000123'
    const payload = buildIvmsPayload({
      paymentId: '1', originatorName: 'Ada', originatorAccount: customer,
      beneficiaryName: 'Bola', beneficiaryAccount: G2, amount: '10', asset: 'USDC',
    })
    expect(payload.originator.accountNumber).toEqual([customer])
    expect(payload.originator.accountNumber).not.toContain(G1)
  })

  it('embeds the shared IVMS101 version constant in the payload', () => {
    const payload = buildIvmsPayload({
      paymentId: '1', originatorName: 'Ada', originatorAccount: G1,
      beneficiaryName: 'Bola', beneficiaryAccount: G2, amount: '10', asset: 'USDC',
    })
    expect(IVMS101_VERSION).toBe('IVMS101.2023')
    expect(payload.ivms101Version).toBe(IVMS101_VERSION)
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

describe('externalRefArg', () => {
  it('returns undefined for a blank value', () => {
    expect(externalRefArg(undefined)).toBeUndefined()
    expect(externalRefArg('')).toBeUndefined()
    expect(externalRefArg('   ')).toBeUndefined()
  })

  it('round-trips a 32-byte reference through hex', () => {
    const hex = 'ab'.repeat(31) + 'cd'
    const bytes = externalRefArg(hex)!
    expect(bytes.length).toBe(32)
    expect(mapPayment({ ...rawPaymentFixture(), external_ref: bytes }).externalRef).toBe(hex)
  })

  it('rejects malformed or wrong-length references', () => {
    expect(() => externalRefArg('zz')).toThrow()
    expect(() => externalRefArg('ab'.repeat(16))).toThrow('32 bytes')
  })
})

function rawPaymentFixture(): RawPayment {
  return {
    id: 1n,
    from_vasp: G1,
    to_vasp: G2,
    beneficiary: G2,
    asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    amount: 1n,
    status: { tag: 'Pending' },
    requires_attestation: false,
    created_at: 1n,
    created_ledger: 1,
    expires_at: 2n,
  }
}
