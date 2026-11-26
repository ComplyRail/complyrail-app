import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import VaspsPage from '@/app/vasps/page'
import { VaspStatus, type VaspEntry } from '@/lib/types'

// config derives Stellar contract ids at import time, which jsdom cannot hash.
vi.mock('@/lib/config', () => ({
  JURISDICTIONS: ['*', 'US', 'GB'],
  isRegistrableJurisdiction: (j: string) => j !== '*',
  ASSET_DECIMALS: 7,
}))

const signer = { publicKey: 'GADMIN' }
const mockSetVaspStatus = vi.fn(async () => undefined)
const mockRun = vi.fn(async (_label: string, fn: (s: typeof signer) => Promise<unknown>) => fn(signer))
const mockReload = vi.fn()

const mockVasps: VaspEntry[] = [
  { address: 'GACME12345678', name: 'Acme VASP', jurisdiction: 'US', publicKey: 'ab'.repeat(32),
    status: VaspStatus.Active, addedAt: 1 },
  { address: 'GBETA12345678', name: 'Beta VASP', jurisdiction: 'GB', publicKey: 'cd'.repeat(32),
    status: VaspStatus.Revoked, addedAt: 2 },
]

vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: 'GADMIN', signer, connect: vi.fn() }),
}))
vi.mock('@/lib/hooks', () => ({
  useRole: () => ({ role: 'admin' }),
  useVasps: () => ({ vasps: mockVasps, loading: false, error: null, reload: mockReload }),
  useLedgerClock: () => ({ now: Date.now() / 1000, source: 'ledger', loading: false }),
}))
vi.mock('@/components/Notice', () => ({
  useTx: () => ({ run: mockRun, pending: false, error: null, done: null, txHash: null }),
  TxStatus: () => null,
  ExplorerLink: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/lib/contract', () => ({
  registerVasp: vi.fn(),
  setVaspExpiry: vi.fn(),
  setVaspStatus: (...args: unknown[]) => mockSetVaspStatus(...args),
}))

describe('VASP suspend and revoke confirmation', () => {
  beforeEach(() => {
    mockSetVaspStatus.mockReset().mockResolvedValue(undefined)
    mockRun.mockClear()
    mockReload.mockClear()
  })

  it('cancels without changing the VASP or sending a transaction', () => {
    render(<VaspsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /suspend acme vasp/i })).toBeInTheDocument()
    expect(within(dialog).getByText(/block it from sending or receiving payments/i)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: 'Should not be submitted' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockSetVaspStatus).not.toHaveBeenCalled()
    expect(mockRun).not.toHaveBeenCalled()
    expect(mockReload).not.toHaveBeenCalled()
  })

  it('requires a reason and confirms the suspension with that reason on-chain', async () => {
    render(<VaspsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /confirm suspension/i })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: '   ' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: '  Failed KYC review  ' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(mockSetVaspStatus).toHaveBeenCalledWith(
      signer, 'GACME12345678', VaspStatus.Suspended, 'Failed KYC review',
    ))
    expect(mockRun).toHaveBeenCalledWith('Suspended Acme VASP: Failed KYC review', expect.any(Function))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockReload).toHaveBeenCalled()
  })

  it('explains that revocation is permanent and passes the reason on confirm', async () => {
    render(<VaspsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /revoke acme vasp/i })).toBeInTheDocument()
    expect(within(dialog).getByText(/permanent/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/cannot be reactivated/i)).toBeInTheDocument()

    const confirm = within(dialog).getByRole('button', { name: /confirm revocation/i })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: 'Sanctions match' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(mockSetVaspStatus).toHaveBeenCalledWith(
      signer, 'GACME12345678', VaspStatus.Revoked, 'Sanctions match',
    ))
    expect(mockSetVaspStatus).toHaveBeenCalledTimes(1)
    expect(mockRun).toHaveBeenCalledWith('Revoked Acme VASP: Sanctions match', expect.any(Function))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
