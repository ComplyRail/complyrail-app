// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Asset, Networks } from '@stellar/stellar-sdk'
import {
  ASSETS,
  buildAssetOptions,
  configValidation,
  explorerBaseFor,
  isValidNetworkPassphrase,
  isValidRpcUrl,
  validateConfig,
} from '@/lib/config'

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

describe('isValidRpcUrl', () => {
  it('accepts valid http and https URLs', () => {
    expect(isValidRpcUrl('https://soroban-testnet.stellar.org')).toBe(true)
    expect(isValidRpcUrl('https://rpc.example.com:8443/soroban/rpc')).toBe(true)
    expect(isValidRpcUrl('http://localhost:8000/soroban/rpc')).toBe(true)
  })

  it('rejects malformed URLs, non-http(s) schemes, and surrounding whitespace', () => {
    expect(isValidRpcUrl('')).toBe(false)
    expect(isValidRpcUrl('   ')).toBe(false)
    expect(isValidRpcUrl('not-a-url')).toBe(false)
    expect(isValidRpcUrl('ftp://soroban-testnet.stellar.org')).toBe(false)
    expect(isValidRpcUrl('javascript:alert(1)')).toBe(false)
    expect(isValidRpcUrl(' https://soroban-testnet.stellar.org')).toBe(false)
    expect(isValidRpcUrl('https://soroban-testnet.stellar.org ')).toBe(false)
  })
})

describe('isValidNetworkPassphrase', () => {
  it('accepts standard and custom single-line passphrases', () => {
    expect(isValidNetworkPassphrase(Networks.TESTNET)).toBe(true)
    expect(isValidNetworkPassphrase(Networks.PUBLIC)).toBe(true)
    expect(isValidNetworkPassphrase('Some Private Network ; 2026')).toBe(true)
  })

  it('rejects empty, padded, or control-character passphrases', () => {
    expect(isValidNetworkPassphrase('')).toBe(false)
    expect(isValidNetworkPassphrase('   ')).toBe(false)
    expect(isValidNetworkPassphrase(' ' + Networks.TESTNET)).toBe(false)
    expect(isValidNetworkPassphrase(Networks.TESTNET + '\n')).toBe(false)
    expect(isValidNetworkPassphrase('Test\nNetwork')).toBe(false)
    expect(isValidNetworkPassphrase('Test\tNetwork')).toBe(false)
  })
})

describe('validateConfig', () => {
  const DEPLOYED_ID = 'CA5T254NPONJHMOA6UWKRPKW2UI3IUOQ6TWUQGP2NFPLAZWOSCVYXS5Q'
  const OTHER_ID = 'C' + 'B'.repeat(55)

  it('passes with no errors or warnings for valid default configuration', () => {
    const result = validateConfig({
      contractId: DEPLOYED_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
      deployedContractId: DEPLOYED_ID,
    })
    expect(result.valid).toBe(true)
    expect(result.contractMismatch).toBe(false)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('passes when NEXT_PUBLIC_CONTRACT_ID matches the deployment record', () => {
    const result = validateConfig({
      contractId: DEPLOYED_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
      deployedContractId: DEPLOYED_ID,
      contractIdOverride: DEPLOYED_ID,
    })
    expect(result.valid).toBe(true)
    expect(result.contractMismatch).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it('warns when NEXT_PUBLIC_CONTRACT_ID differs from the deployment record', () => {
    const result = validateConfig({
      contractId: OTHER_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
      deployedContractId: DEPLOYED_ID,
      contractIdOverride: OTHER_ID,
    })
    expect(result.valid).toBe(true)
    expect(result.contractMismatch).toBe(true)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('contract_mismatch')
    expect(result.warnings[0].message).toContain(OTHER_ID)
    expect(result.warnings[0].message).toContain(DEPLOYED_ID)
  })

  it('reports an error for an invalid contract ID format', () => {
    const result = validateConfig({
      contractId: 'NOT_A_CONTRACT_ID',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: Networks.TESTNET,
      deployedContractId: DEPLOYED_ID,
      contractIdOverride: 'NOT_A_CONTRACT_ID',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.code === 'invalid_contract_id')).toBe(true)
    expect(result.contractMismatch).toBe(true)
  })

  it('reports an error for an invalid RPC URL', () => {
    const result = validateConfig({
      contractId: DEPLOYED_ID,
      rpcUrl: 'ws://not-http.example.com',
      networkPassphrase: Networks.TESTNET,
      deployedContractId: DEPLOYED_ID,
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('invalid_rpc_url')
  })

  it('reports an error for an invalid network passphrase format', () => {
    const result = validateConfig({
      contractId: DEPLOYED_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: '  ',
      deployedContractId: DEPLOYED_ID,
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('invalid_network_passphrase')
  })

  it('warns on an unrecognized but well-formed network passphrase', () => {
    const result = validateConfig({
      contractId: DEPLOYED_ID,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Custom Private Network ; 2026',
      deployedContractId: DEPLOYED_ID,
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('unknown_network_passphrase')
  })

  it('validates the shipped runtime configuration cleanly', () => {
    expect(configValidation.valid).toBe(true)
  })
})
