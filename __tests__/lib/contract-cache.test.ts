// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const clientCtor = vi.hoisted(() => vi.fn())

vi.mock('@/packages/complyrail-client/src', () => ({
  Client: clientCtor,
}))

vi.mock('@/lib/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/config')>()
  return {
    ...actual,
    isContractConfigured: true,
    config: { ...actual.config, contractId: 'C' + 'A'.repeat(55) },
  }
})

import { clearClientCache, releasePayment, type Signer } from '@/lib/contract'

const G1 = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'

function fakeClient() {
  const tx = {
    result: undefined,
    signAndSend: async () => ({ result: undefined }),
  }
  return { release_payment: vi.fn(async () => tx) }
}

function signerFor(walletId: string): Signer {
  return { walletId, publicKey: G1, signTransaction: vi.fn(async (xdr: string) => ({ signedTxXdr: xdr })) } as Signer
}

describe('contract client cache', () => {
  beforeEach(() => {
    clientCtor.mockReset()
    clientCtor.mockImplementation(function () {
      return fakeClient()
    })
    clearClientCache()
  })

  it('reuses the client for the same wallet and address', async () => {
    const s = signerFor('freighter')
    await releasePayment(s, '1')
    await releasePayment(s, '2')
    expect(clientCtor).toHaveBeenCalledTimes(1)
  })

  it('creates a new client after disconnect, with the new signer', async () => {
    const first = signerFor('freighter')
    await releasePayment(first, '1')
    clearClientCache()

    const second = signerFor('freighter')
    await releasePayment(second, '1')
    expect(clientCtor).toHaveBeenCalledTimes(2)
    expect(clientCtor.mock.calls[1][0].signTransaction).toBe(second.signTransaction)
    expect(clientCtor.mock.calls[1][0].signTransaction).not.toBe(first.signTransaction)
  })

  it('keys clients by wallet as well as address', async () => {
    await releasePayment(signerFor('freighter'), '1')
    await releasePayment(signerFor('albedo'), '1')
    expect(clientCtor).toHaveBeenCalledTimes(2)
  })
})
