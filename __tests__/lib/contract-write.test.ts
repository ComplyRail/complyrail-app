// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const from = vi.hoisted(() => vi.fn())

vi.mock('@stellar/stellar-sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>()
  return { ...actual, contract: { ...actual.contract, Client: { from } } }
})

vi.mock('@/lib/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  return {
    ...actual,
    isContractConfigured: true,
    config: { ...actual.config, contractId: 'C' + 'A'.repeat(55) },
  }
})

import { clearClientCache, releasePayment, TxFailedError, type Signer } from '@/lib/contract'

const G1 = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const HASH = 'ab'.repeat(32)

// Mirrors the parts of AssembledTransaction / SentTransaction that write() uses.
function clientReturning(status: 'SUCCESS' | 'FAILED') {
  const sent = {
    result: undefined,
    sendTransactionResponse: { hash: HASH },
    getTransactionResponse: { status },
  }
  return { release_payment: vi.fn(async () => ({ result: undefined, signAndSend: async () => sent })) }
}

const signer: Signer = { walletId: 'freighter', publicKey: G1, signTransaction: vi.fn() } as unknown as Signer

describe('contract writes: final transaction status', () => {
  beforeEach(() => {
    clearClientCache()
    from.mockReset()
  })

  it('throws a typed error carrying the hash when the transaction FAILED', async () => {
    from.mockResolvedValue(clientReturning('FAILED'))
    const err = await releasePayment(signer, '1').catch(e => e)
    expect(err).toBeInstanceOf(TxFailedError)
    expect(err.txHash).toBe(HASH)
    expect(err.message).toMatch(/failed/i)
  })

  it('resolves when the transaction SUCCEEDED', async () => {
    from.mockResolvedValue(clientReturning('SUCCESS'))
    await expect(releasePayment(signer, '1')).resolves.toBeUndefined()
  })
})
