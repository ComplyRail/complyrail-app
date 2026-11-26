// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Asset, Networks } from '@stellar/stellar-sdk'
import { ASSETS, buildAssetOptions, explorerBaseFor, verifyAssetContracts } from '@/lib/config'

describe('explorerBaseFor', () => {
  it('links testnet to the testnet explorer', () => {
    expect(explorerBaseFor(Networks.TESTNET)).toBe('https://stellar.expert/explorer/testnet')
  })

  it('links public network to the public explorer', () => {
    expect(explorerBaseFor(Networks.PUBLIC)).toBe('https://stellar.expert/explorer/public')
  })

  it('returns null for an unsupported passphrase instead of falling back to testnet', () => {
    expect(explorerBaseFor('Some Private Network ; 2026')).toBeNull()
    expect(explorerBaseFor('')).toBeNull()
    expect(explorerBaseFor('constructor')).toBeNull()
  })
})

describe('buildAssetOptions', () => {
  const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

  it('builds contract IDs for native and issued assets', () => {
    const out = buildAssetOptions(
      [{ symbol: 'XLM', native: true }, { symbol: 'USDC', issuer: ISSUER }],
      Networks.TESTNET,
    )
    expect(out.map(a => a.symbol)).toEqual(['XLM', 'USDC'])
    expect(out[0].contractId).toBe(Asset.native().contractId(Networks.TESTNET))
    expect(out[1].contractId).toBe(new Asset('USDC', ISSUER).contractId(Networks.TESTNET))
  })

  it('accepts the shipped config/assets.json', () => {
    expect(ASSETS.map(a => a.symbol)).toEqual(['XLM', 'USDC'])
  })

  it('rejects an invalid issuer', () => {
    expect(() => buildAssetOptions([{ symbol: 'USDC', issuer: 'NOTAKEY' }], Networks.TESTNET))
      .toThrow(/valid Stellar public key/)
    expect(() => buildAssetOptions([{ symbol: 'USDC' }], Networks.TESTNET)).toThrow(/valid Stellar public key/)
  })

  it('rejects a bad or duplicate symbol', () => {
    expect(() => buildAssetOptions([{ symbol: 'usdc', issuer: ISSUER }], Networks.TESTNET)).toThrow(/symbol/)
    expect(() => buildAssetOptions([{ symbol: '', native: true }], Networks.TESTNET)).toThrow(/symbol/)
    expect(() => buildAssetOptions(
      [{ symbol: 'USDC', issuer: ISSUER }, { symbol: 'USDC', issuer: ISSUER }],
      Networks.TESTNET,
    )).toThrow(/duplicate symbol USDC/)
  })

  it('rejects a native asset that also names an issuer', () => {
    expect(() => buildAssetOptions([{ symbol: 'XLM', native: true, issuer: ISSUER }], Networks.TESTNET))
      .toThrow(/must not have an issuer/)
  })
})

describe('verifyAssetContracts', () => {
  beforeEach(() => {
    // Reset available flags before each test.
    for (const a of ASSETS) a.available = null
  })

  it('marks assets available when the name() call succeeds', async () => {
    // Patch contract.Client.from on the already-imported SDK module.
    const sdk = await import('@stellar/stellar-sdk')
    const original = sdk.contract.Client.from
    sdk.contract.Client.from = vi.fn().mockResolvedValue({
      name: vi.fn().mockResolvedValue({ result: 'XLM' }),
    }) as unknown as typeof sdk.contract.Client.from

    const { verifyAssetContracts: verify } = await import('@/lib/config')
    await verify('https://soroban-testnet.stellar.org', (await import('@stellar/stellar-sdk')).Networks.TESTNET)
    expect(ASSETS.every(a => a.available === true)).toBe(true)

    sdk.contract.Client.from = original
  })

  it('marks assets unavailable when the name() call fails', async () => {
    const sdk = await import('@stellar/stellar-sdk')
    const original = sdk.contract.Client.from
    sdk.contract.Client.from = vi.fn().mockResolvedValue({
      name: vi.fn().mockRejectedValue(new Error('contract not found')),
    }) as unknown as typeof sdk.contract.Client.from

    const { verifyAssetContracts: verify } = await import('@/lib/config')
    await verify('https://soroban-testnet.stellar.org', sdk.Networks.TESTNET)
    expect(ASSETS.every(a => a.available === false)).toBe(true)

    sdk.contract.Client.from = original
  })
})
