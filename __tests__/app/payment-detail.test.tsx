import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaymentDetail } from '@/app/payments/view/PaymentDetail'

const reload = vi.fn()

vi.mock('@/lib/hooks', () => ({
  usePayment: vi.fn(),
  useVasp: () => ({ vasp: null }),
  useAdmin: () => ({ admin: null }),
  useLedgerClock: () => ({ now: 0, source: 'ledger' as const, loading: false }),
}))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: null }),
}))
vi.mock('@/components/Notice', () => ({
  ExplorerLink: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  TxStatus: () => null,
  useTx: () => ({ run: vi.fn(), pending: false, error: null, done: null, txHash: null }),
}))
vi.mock('@/app/payments/view/IvmsDecryptPanel', () => ({
  IvmsDecryptPanel: () => null,
}))
vi.mock('@/components/ClockWarning', () => ({
  ClockWarning: () => null,
}))
vi.mock('@/lib/config', () => ({
  assetSymbol: () => 'XLM',
}))
vi.mock('@/lib/format', () => ({
  formatAddress: (a: string) => a,
  fromUnits: (v: string) => v,
}))
vi.mock('@/lib/contract', () => ({
  buildIvmsPayload: vi.fn(),
  canonicalJson: vi.fn(),
  reclaimExpired: vi.fn(),
  rejectPayment: vi.fn(),
  releasePayment: vi.fn(),
  sha256Hex: vi.fn(),
  submitAttestation: vi.fn(),
}))
vi.mock('@/lib/ivms-crypto', () => ({
  sealIvmsPayload: vi.fn(),
}))
vi.mock('@/lib/ivms', () => ({
  verifyIvmsPayload: vi.fn(),
}))

import { usePayment } from '@/lib/hooks'

const mockUsePayment = vi.mocked(usePayment)

describe('PaymentDetail', () => {
  beforeEach(() => {
    reload.mockReset()
    mockUsePayment.mockReset()
  })

  it('shows a retry button and the error message for load failures', () => {
    mockUsePayment.mockReturnValue({
      payment: null,
      loading: false,
      error: 'network down',
      reload,
    } as any)

    render(<PaymentDetail id="42" />)

    expect(screen.getByText(/Failed to load payment/i)).toBeTruthy()
    expect(screen.getByText(/network down/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Payment #42 not found/i)).toBeNull()
  })

  it('keeps "not found" for a confirmed missing payment', () => {
    mockUsePayment.mockReturnValue({
      payment: null,
      loading: false,
      error: null,
      reload,
    } as any)

    render(<PaymentDetail id="42" />)

    expect(screen.getByText('Payment #42 not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    expect(screen.queryByText(/Failed to load payment/i)).toBeNull()
  })
})
