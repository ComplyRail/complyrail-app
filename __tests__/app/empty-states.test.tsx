import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    configured: true,
    address: undefined as string | undefined,
    payments: {
      payments: [] as unknown[],
      total: 0,
      hasMore: false,
      loadMore: vi.fn(),
      loadingMore: false,
      moreError: null as string | null,
      loading: false,
      error: null as string | null,
    },
    vasps: {
      vasps: [] as unknown[],
      loading: false,
      error: null as string | null,
      reload: vi.fn(),
    },
  },
}))

vi.mock('@/lib/config', () => ({
  get isContractConfigured() {
    return mocks.configured
  },
  ASSET_DECIMALS: 7,
  ASSETS: [],
  assetSymbol: () => 'USDC',
  JURISDICTIONS: ['US', 'GB', '*'],
  isRegistrableJurisdiction: (j: string) => j.trim() !== '' && j.trim() !== '*',
  config: {},
  explorerBase: 'https://stellar.expert/explorer/testnet',
}))
vi.mock('@/lib/hooks', () => ({
  usePayments: () => mocks.payments,
  useVasps: () => mocks.vasps,
  useRole: () => ({ role: 'viewer', loading: false }),
  useLedgerClock: () => ({ now: 1_000, source: 'ledger', loading: false }),
}))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({
    address: mocks.address,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signer: undefined,
  }),
}))
vi.mock('@/lib/contract', () => ({
  registerVasp: vi.fn(),
  setVaspExpiry: vi.fn(),
  setVaspStatus: vi.fn(),
}))

import PaymentsPage from '@/app/payments/page'
import VaspsPage from '@/app/vasps/page'

describe('Payments empty state', () => {
  beforeEach(() => {
    mocks.configured = true
    mocks.address = undefined
    mocks.payments = {
      payments: [],
      total: 0,
      hasMore: false,
      loadMore: vi.fn(),
      loadingMore: false,
      moreError: null,
      loading: false,
      error: null,
    }
  })

  it('asks a disconnected visitor to connect instead of claiming there are no payments', () => {
    render(<PaymentsPage />)
    expect(screen.getByText(/Connect your wallet to see your payments/)).toBeInTheDocument()
    expect(screen.queryByText('No payments yet')).toBeNull()
  })

  it('says there are no payments only when a wallet is connected', () => {
    mocks.address = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
    render(<PaymentsPage />)
    expect(screen.getByText('No payments yet')).toBeInTheDocument()
  })

  it('does not blame an empty list when the contract is not deployed', () => {
    mocks.configured = false
    render(<PaymentsPage />)
    expect(screen.getByText(/contract is not deployed yet/)).toBeInTheDocument()
  })

  it('keeps loading and read failures distinct from an empty result', () => {
    mocks.payments = { ...mocks.payments, loading: true }
    const { rerender } = render(<PaymentsPage />)
    expect(screen.getByText('Loading from contract…')).toBeInTheDocument()

    mocks.payments = { ...mocks.payments, loading: false, error: 'RPC unavailable' }
    rerender(<PaymentsPage />)
    expect(screen.getByText('Error: RPC unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/Connect your wallet/)).toBeNull()
  })
})

describe('VASPs empty state', () => {
  beforeEach(() => {
    mocks.configured = true
    mocks.address = undefined
    mocks.vasps = { vasps: [], loading: false, error: null, reload: vi.fn() }
  })

  it('adds a connect hint when no wallet is connected', () => {
    render(<VaspsPage />)
    expect(screen.getByText(/Connect your wallet to see whether you can register one/)).toBeInTheDocument()
  })

  it('shows the plain empty message for a connected wallet', () => {
    mocks.address = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
    render(<VaspsPage />)
    expect(screen.getByText('No VASPs registered yet.')).toBeInTheDocument()
  })

  it('reports a missing deployment instead of "no VASPs"', () => {
    mocks.configured = false
    render(<VaspsPage />)
    expect(screen.getByText(/contract is not deployed yet/)).toBeInTheDocument()
  })

  it('shows a read error rather than an empty directory', () => {
    mocks.vasps = { ...mocks.vasps, error: 'RPC unavailable' }
    render(<VaspsPage />)
    expect(screen.getByText('Error: RPC unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/No VASPs registered yet/)).toBeNull()
  })

  it('shows a truncated key in the directory and links the name to the detail view', () => {
    const address = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
    const key = '0123456789abcdef'.repeat(4)
    mocks.address = address
    mocks.vasps = {
      vasps: [{
        address,
        name: 'Acme VASP',
        jurisdiction: 'US',
        publicKey: key,
        status: 'active',
        addedAt: 1_000,
      }],
      loading: false,
      error: null,
      reload: vi.fn(),
    }
    render(<VaspsPage />)

    expect(screen.getAllByText('01234567…89abcdef')).toHaveLength(2) // table and mobile card
    expect(screen.queryByText(key)).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Acme VASP' })[0]).toHaveAttribute(
      'href',
      `/vasps/view?address=${address}`,
    )
  })
})
