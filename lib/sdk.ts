import { ComplyRailClient } from 'complyrail-sdk'

const config = {
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org:443',
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
}

export const client = new ComplyRailClient(config)

export { ComplyRailClient }
export * from 'complyrail-sdk'
