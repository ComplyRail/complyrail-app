// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Networks } from '@stellar/stellar-sdk'
import { explorerBaseFor } from '@/lib/config'

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
