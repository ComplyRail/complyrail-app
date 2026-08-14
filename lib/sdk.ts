// SDK configuration
export const config = {
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org:443',
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
}

// Mock client for now - will be replaced with real ComplyRailClient from SDK
export const client = {
  registerVasp: async () => ({ txId: 'mock_tx_1' }),
  submitPayment: async () => ({ txId: 'mock_tx_2' }),
  submitAttestation: async () => ({ txId: 'mock_tx_3' }),
  releasePayment: async () => ({ txId: 'mock_tx_4' }),
  rejectPayment: async () => ({ txId: 'mock_tx_5' }),
  getVaspStatus: async () => ({ status: 'active' }),
  getPaymentStatus: async () => ({ status: 'released' }),
}
