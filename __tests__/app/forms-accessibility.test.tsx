import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VaspsPage from '@/app/vasps/page'
import { PaymentDetail } from '@/app/payments/view/PaymentDetail'
import { PaymentStatus } from '@/lib/types'

vi.mock('@/lib/hooks', () => ({
  useAdmin: () => ({ admin: null }),
  useLedgerClock: () => ({ now: 0 }),
  usePayment: () => ({
    payment: {
      id: '1',
      fromVasp: 'G_ORIGINATOR',
      toVasp: 'G_RECIPIENT',
      beneficiary: 'G_BENEFICIARY',
      asset: 'ASSET',
      amount: '10000000',
      status: PaymentStatus.Pending,
      requiresAttestation: true,
      createdAt: 0,
      createdLedger: 0,
      expiresAt: 100,
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  useRole: () => ({ role: 'admin' }),
  useVasp: () => ({ vasp: null }),
  useVasps: () => ({ vasps: [], loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/components/WalletProvider', () => ({ useWallet: () => ({ address: 'G_ORIGINATOR' }) }))
vi.mock('@/components/Notice', () => ({
  ExplorerLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TxStatus: () => null,
  useTx: () => ({ pending: false, run: vi.fn() }),
}))
vi.mock('@/components/ClockWarning', () => ({ ClockWarning: () => null }))
vi.mock('@/components/IvmsDecryptPanel', () => ({ IvmsDecryptPanel: () => null }))
vi.mock('@/lib/config', () => ({
  JURISDICTIONS: ['US', 'GB', '*'],
  assetSymbol: () => 'XLM',
  isRegistrableJurisdiction: () => true,
}))
vi.mock('@/lib/format', () => ({
  formatAddress: (address: string) => address,
  fromUnits: () => '1',
  vaspKeyError: () => null,
}))
vi.mock('@/lib/wallet', () => ({ isValidStellarAddress: () => true }))
vi.mock('@/lib/contract', () => ({
  registerVasp: vi.fn(),
  setVaspExpiry: vi.fn(),
  setVaspStatus: vi.fn(),
  buildIvmsPayload: vi.fn(),
  canonicalJson: vi.fn(),
  reclaimExpired: vi.fn(),
  rejectPayment: vi.fn(),
  releasePayment: vi.fn(),
  sha256Hex: vi.fn(),
  submitAttestation: vi.fn(),
}))
vi.mock('@/lib/ivms-crypto', () => ({ sealIvmsPayload: vi.fn() }))
vi.mock('@/lib/ivms', () => ({ verifyIvmsPayload: vi.fn() }))

function expectRequiredLabeledControls(labels: string[]) {
  for (const label of labels) {
    expect(screen.getByText(label)).toBeVisible()
    const control = screen.getByLabelText(label)
    expect(control).toBeRequired()
  }
}

describe('form accessibility', () => {
  it('associates visible labels with VASP registration fields and marks required fields', () => {
    render(<VaspsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Register VASP' }))

    expectRequiredLabeledControls([
      'Stellar address (required)',
      'Legal name (required)',
      'Jurisdiction (required)',
      'IVMS101 encryption public key (64 hex chars, required)',
    ])
    expect(screen.getByText('Registration valid for (days, optional)')).toBeVisible()
    expect(screen.getByLabelText('Registration valid for (days, optional)')).toBeInTheDocument()
  })

  it('associates visible labels with attestation fields and marks them required', () => {
    render(<PaymentDetail id="1" />)

    expectRequiredLabeledControls([
      'Originator full name (required)',
      'Originator account (customer account number, required)',
      'Beneficiary full name (required)',
    ])
  })
})
