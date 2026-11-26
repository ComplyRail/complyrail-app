import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const BASE_PAYMENT = {
  id: '7',
  fromVasp: 'GORIGINATOR000000000000000000000000000000000000000000000',
  toVasp: 'GBENEFICIARY0000000000000000000000000000000000000000000',
  beneficiary: 'GCUSTOMER0000000000000000000000000000000000000000000000',
  asset: 'CUSDC00000000000000000000000000000000000000000000000002',
  amount: '10000000',
  status: 'pending',
  requiresAttestation: false,
  attestationHash: 'ab'.repeat(32),
  createdAt: 100,
  createdLedger: 5,
  expiresAt: 10_000,
}

const ADMIN = BASE_PAYMENT.toVasp

const { mocks } = vi.hoisted(() => ({
  mocks: {
    address: 'GBENEFICIARY0000000000000000000000000000000000000000000',
    now: 500,
    payment: null as unknown,
    vaspActive: true,
  },
}))

vi.mock('@/lib/config', () => ({
  ASSET_DECIMALS: 7,
  assetSymbol: () => 'USDC',
  config: {},
}))
vi.mock('@/lib/hooks', () => ({
  usePayment: () => ({ payment: mocks.payment, loading: false, error: null, reload: vi.fn() }),
  useLedgerClock: () => ({ now: mocks.now, source: 'ledger', loading: false }),
  useVasp: () => ({
    vasp: {
      address: BASE_PAYMENT.toVasp,
      name: 'Beneficiary VASP',
      jurisdiction: 'US',
      publicKey: 'ab'.repeat(32),
      status: mocks.vaspActive ? 'active' : 'suspended',
    },
    loading: false,
    error: null,
  }),
  useAdmin: () => ({ admin: ADMIN, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: mocks.address, signer: { publicKey: mocks.address } }),
}))
vi.mock('@/components/Notice', () => ({
  useTx: () => ({ run: vi.fn(), pending: false, error: null, done: null, txHash: null, signedIn: true }),
  TxStatus: () => null,
  ExplorerLink: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ClockWarning', () => ({ ClockWarning: () => null }))
vi.mock('@/app/payments/view/IvmsDecryptPanel', () => ({ IvmsDecryptPanel: () => null }))
vi.mock('@/lib/contract', () => ({
  buildIvmsPayload: vi.fn(),
  canonicalJson: vi.fn(),
  reclaimExpired: vi.fn(),
  rejectPayment: vi.fn(),
  releasePayment: vi.fn(),
  sha256Hex: vi.fn(),
  submitAttestation: vi.fn(),
}))
vi.mock('@/lib/ivms-crypto', () => ({ sealIvmsPayload: vi.fn() }))

import { PaymentDetail } from '@/app/payments/view/PaymentDetail'
import { CONTRACT_ERRORS } from '@/lib/errors'

describe('PaymentDetail unavailable actions', () => {
  beforeEach(() => {
    mocks.address = BASE_PAYMENT.toVasp
    mocks.now = 500
    mocks.vaspActive = true
    mocks.payment = { ...BASE_PAYMENT }
  })

  it('explains that release needs an attestation and keeps the button visible', () => {
    mocks.payment = { ...BASE_PAYMENT, requiresAttestation: true, attestationHash: undefined }
    render(<PaymentDetail id="7" />)

    expect(screen.getByRole('button', { name: 'Release to beneficiary' })).toBeDisabled()
    expect(screen.getByTestId('release-reason')).toHaveTextContent(CONTRACT_ERRORS[9])
  })

  it('shows why release is too late while leaving reject available', () => {
    mocks.now = BASE_PAYMENT.expiresAt
    render(<PaymentDetail id="7" />)

    expect(screen.getByRole('button', { name: 'Release to beneficiary' })).toBeDisabled()
    expect(screen.getByTestId('release-reason')).toHaveTextContent(CONTRACT_ERRORS[36])

    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'Expired before settlement' } })
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('explains the permission requirement instead of hiding the actions', () => {
    mocks.address = 'GVIEWER000000000000000000000000000000000000000000000000'
    render(<PaymentDetail id="7" />)

    expect(screen.getByRole('button', { name: 'Release to beneficiary' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(screen.getByTestId('release-reason')).toHaveTextContent(CONTRACT_ERRORS[11])
    expect(screen.getByTestId('reject-reason')).toHaveTextContent(CONTRACT_ERRORS[11])
    expect(screen.getByText(/only available to the receiving VASP or the admin/i)).toBeInTheDocument()
  })

  it('explains that a pasted payload is invalid before release is enabled', async () => {
    render(<PaymentDetail id="7" />)

    expect(screen.getByTestId('release-reason')).toHaveTextContent(/Paste and verify/)
    fireEvent.change(screen.getByLabelText('Received IVMS101 payload (JSON)'), { target: { value: 'not json' } })

    await waitFor(() => expect(screen.getByTestId('release-reason')).toHaveTextContent(/Not valid JSON/))
    expect(screen.getByRole('button', { name: 'Release to beneficiary' })).toBeDisabled()
  })

  it('explains the missing reason on Reject until one is entered', () => {
    render(<PaymentDetail id="7" />)

    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(screen.getByTestId('reject-reason')).toHaveTextContent(/Enter a reason/)
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'IVMS data missing' } })
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('explains that reclaim is not available before expiry', () => {
    mocks.address = BASE_PAYMENT.fromVasp
    render(<PaymentDetail id="7" />)

    expect(screen.getByRole('button', { name: 'Reclaim expired payment' })).toBeDisabled()
    expect(screen.getByTestId('reclaim-reason')).toHaveTextContent(CONTRACT_ERRORS[12])
  })
})
