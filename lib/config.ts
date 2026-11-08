import { Asset, Networks } from '@stellar/stellar-sdk'
import deployment from '../contracts/deployments/testnet.json'

/**
 * Runtime configuration.
 *
 * The contract ID comes from NEXT_PUBLIC_CONTRACT_ID if set, otherwise from
 * contracts/deployments/testnet.json, which the "Deploy to testnet" GitHub
 * Action writes after each deployment.
 */
export const config = {
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || deployment.contractId || '',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || Networks.TESTNET,
}

export const isContractConfigured = /^C[A-Z2-7]{55}$/.test(config.contractId)

export const explorerBase = 'https://stellar.expert/explorer/testnet'

/** All Stellar assets use 7 decimal places. */
export const ASSET_DECIMALS = 7

export interface AssetOption {
  symbol: string
  /** Stellar Asset Contract (SAC) address used by the ComplyRail contract. */
  contractId: string
}

/** Circle's testnet USDC issuer. */
const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

export const ASSETS: AssetOption[] = [
  { symbol: 'XLM', contractId: Asset.native().contractId(config.networkPassphrase) },
  {
    symbol: 'USDC',
    contractId: new Asset('USDC', TESTNET_USDC_ISSUER).contractId(config.networkPassphrase),
  },
]

export function assetSymbol(contractId: string): string {
  return ASSETS.find(a => a.contractId === contractId)?.symbol ?? contractId.slice(0, 6)
}

/** ISO-style jurisdiction codes offered in the UI. `*` is the contract's fallback rule. */
export const JURISDICTIONS = ['US', 'GB', 'EU', 'SG', 'HK', 'JP', 'AU', 'CA', 'NG', '*']
