import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NewPaymentPage from '@/app/payments/new/page'

// lib/config derives SAC ids with the Stellar SDK, which can't hash under jsdom; fixed ids are enough here.
vi.mock('@/lib/config', () => {
  const ASSETS = [
    { symbol: 'XLM', contractId: 'CXLM000000000000000000000000000000000000000000000000001' },
    { symbol: 'USDC', contractId: 'CUSDC00000000000000000000000000000000000000000000000002' },
  ]
  return {
    ASSETS,
    ASSET_DECIMALS: 7,
    assetSymbol: (id: string) => ASSETS.find(a => a.contractId === id)?.symbol ?? id.slice(0, 6),
    isContractConfigured: true,
    explorerBase: 'https://stellar.expert/explorer/testnet',
    config: {},
  }
})

const ASSETS = [
  { symbol: 'XLM', contractId: 'CXLM000000000000000000000000000000000000000000000000001' },
  { symbol: 'USDC', contractId: 'CUSDC00000000000000000000000000000000000000000000000002' },
]

const getAssetBalance = vi.fn()
const submitPayment = vi.fn()
const NOW = 1_800_000_000
const DAY = 86_400
const vasps = [
  { address: 'GOTHER', name: 'Other VASP', jurisdiction: 'US', status: 'active', expiresAt: NOW + DAY },
  { address: 'GEXPIRED', name: 'Expired VASP', jurisdiction: 'US', status: 'active', expiresAt: NOW - 1 },
]

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: 'GWALLET', signer: { publicKey: 'GWALLET' }, connect: vi.fn() }),
}))
vi.mock('@/lib/hooks', () => ({
  useRole: () => ({ role: 'vasp' }),
  useVasps: () => ({ vasps }),
  useLedgerClock: () => ({ now: NOW, source: 'ledger', loading: false }),
}))
vi.mock('@/lib/wallet', () => ({ isValidStellarAddress: () => true }))
vi.mock('@/lib/contract', () => ({
  getAssetBalance: (...args: unknown[]) => getAssetBalance(...args),
  submitPayment: (...args: unknown[]) => submitPayment(...args),
}))

describe('Submit Payment balance check', () => {
  beforeEach(() => {
    getAssetBalance.mockReset()
    submitPayment.mockReset()
    getAssetBalance.mockResolvedValue(25_000_000n) // 2.5 units of the asset
  })

  it('shows the balance of the selected asset', async () => {
    render(<NewPaymentPage />)
    await waitFor(() => expect(screen.getByTestId('balance').textContent).toContain('Available: 2.5'))
    expect(getAssetBalance).toHaveBeenCalledWith(ASSETS[0].contractId, 'GWALLET')
  })

  it('re-reads the balance when the asset changes', async () => {
    getAssetBalance.mockResolvedValueOnce(25_000_000n).mockResolvedValueOnce(900_000_000n)
    const { container } = render(<NewPaymentPage />)
    await waitFor(() => expect(screen.getByTestId('balance').textContent).toContain('Available: 2.5'))

    const assetSelect = container.querySelector('select[name="asset"]') as HTMLSelectElement
    fireEvent.change(assetSelect, { target: { name: 'asset', value: ASSETS[1].contractId } })

    await waitFor(() => expect(getAssetBalance).toHaveBeenLastCalledWith(ASSETS[1].contractId, 'GWALLET'))
    await waitFor(() => expect(screen.getByTestId('balance').textContent).toContain('Available: 90'))
  })

  it('warns and disables submit when the amount is above the balance', async () => {
    render(<NewPaymentPage />)
    await waitFor(() => expect(screen.getByTestId('balance').textContent).toContain('Available: 2.5'))

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { name: 'amount', value: '3' } })

    expect(screen.getByRole('alert').textContent).toContain('more than your balance')
    expect(screen.getByRole('button', { name: /sign & submit/i })).toBeDisabled()
  })

  it('does not warn when the amount fits the balance', async () => {
    render(<NewPaymentPage />)
    await waitFor(() => expect(screen.getByTestId('balance').textContent).toContain('Available: 2.5'))

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { name: 'amount', value: '2.5' } })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /sign & submit/i })).not.toBeDisabled()
  })

  it('shows expired VASPs only as disabled options', () => {
    const { container } = render(<NewPaymentPage />)
    const toVaspSelect = container.querySelector('select[name="toVasp"]') as HTMLSelectElement
    const expiredOption = toVaspSelect.querySelector('option[value="GEXPIRED"]') as HTMLOptionElement

    expect(expiredOption).not.toBeNull()
    expect(expiredOption.disabled).toBe(true)
    expect(expiredOption.textContent).toContain('expired')
    expect(expiredOption.parentElement?.label).toContain('expired')
    expect((toVaspSelect.querySelector('option[value="GOTHER"]') as HTMLOptionElement).disabled).toBe(false)
  })
})
