import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import ContractPage from '@/app/admin/page'
import deployment from '../../contracts/deployments/testnet.json'

const { mockConfig, mockAdmin } = vi.hoisted(() => ({
  mockConfig: { contractId: '', rpcUrl: 'https://rpc.example' },
  mockAdmin: 'GADMIN1234567890',
}))

vi.mock('@/lib/config', () => ({
  config: mockConfig,
  isContractConfigured: true,
}))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: mockAdmin, signer: null, connect: vi.fn() }),
}))
vi.mock('@/components/Notice', () => ({
  ExplorerLink: ({ id, children }: { id: string; children?: ReactNode }) => children ?? id,
  TxStatus: () => null,
  useTx: () => ({ run: vi.fn(), pending: false, error: null, done: null, txHash: null }),
}))
vi.mock('@/lib/hooks', () => ({
  useAdmin: () => ({ admin: mockAdmin, loading: false, reload: vi.fn() }),
  useVasps: () => ({ vasps: [] }),
  usePayments: () => ({ total: 0 }),
  usePendingAdmin: () => ({ pendingAdmin: null, reload: vi.fn() }),
}))
vi.mock('@/lib/contract', () => ({
  acceptAdmin: vi.fn(),
  cancelAdminProposal: vi.fn(),
  proposeAdmin: vi.fn(),
}))

const expectedDeployedAt = deployment.deployedAt.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC')

describe('Contract page deployment metadata', () => {
  beforeEach(() => {
    mockConfig.contractId = deployment.contractId
    mockConfig.rpcUrl = 'https://rpc.example'
  })

  it('shows WASM hash, commit and deploy time when the record matches the active contract', () => {
    render(<ContractPage />)

    expect(screen.getByText('WASM sha256')).toBeInTheDocument()
    expect(screen.getByText(deployment.wasmHash)).toBeInTheDocument()
    expect(screen.getByText('Source commit')).toBeInTheDocument()
    expect(screen.getByText(deployment.commit.slice(0, 7))).toBeInTheDocument()
    expect(screen.getByText('Deployed')).toBeInTheDocument()
    expect(screen.getByText(expectedDeployedAt)).toBeInTheDocument()
    expect(screen.queryByText('metadata unavailable for this contract')).toBeNull()
  })

  it('hides metadata and explains why when the contract id comes from an override', () => {
    mockConfig.contractId = 'COVERRIDE123456789012345678901234567890123456789012345678901234567890'
    render(<ContractPage />)

    expect(screen.getByText(mockConfig.contractId)).toBeInTheDocument()
    expect(screen.queryByText('WASM sha256')).toBeNull()
    expect(screen.queryByText(deployment.wasmHash)).toBeNull()
    expect(screen.queryByText('Source commit')).toBeNull()
    expect(screen.queryByText('Deployed')).toBeNull()
    expect(screen.getByText('metadata unavailable for this contract')).toBeInTheDocument()
  })
})
