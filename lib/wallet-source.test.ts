
import { describe, it, expect } from 'vitest'
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { assertSignedTransactionSource } from '@/lib/wallet'

describe('assertSignedTransactionSource', () => {
  it('rejects a transaction signed for a different source account', () => {
    const source = Keypair.random().publicKey()
    const connected = Keypair.random().publicKey()

    const transaction = new TransactionBuilder(
      new Account(source, '0'),
      {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      },
    )
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build()

    expect(() =>
      assertSignedTransactionSource(
        transaction.toXDR(),
        connected,
        Networks.TESTNET,
      ),
    ).toThrow(/does not match/)
  })
})
