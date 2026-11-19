// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Asset, Networks } from '@stellar/stellar-sdk'
import { ASSETS, buildAssetOptions, explorerBaseFor } from '@/lib/config'

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
    expect(() => buildAssetOptions([{ symbol: '' , native: true }], Networks.TESTNET)).toThrow(/symbol/)
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
