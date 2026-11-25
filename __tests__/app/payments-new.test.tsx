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

// The originator's VASP and its threshold drive the attestation preview.
const hookState = vi.hoisted(() => ({
  vasp: { vasp: { address: 'GWALLET', name: 'My VASP', jurisdiction: 'US' } } as {
    vasp: { address: string; name: string; jurisdiction: string } | null
  },
  threshold: { threshold: 1_000_000_000n as bigint | null, loading: false },
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: 'GWALLET', signer: { publicKey: 'GWALLET' }, connect: vi.fn() }),
}))
vi.mock('@/lib/hooks', () => ({
  useRole: () => ({ role: 'vasp' }),
  useVasps: () => ({
    vasps: [{ address: 'GOTHER', name: 'Other VASP', jurisdiction: 'US', status: 'active' }],
  }),
  useVasp: () => hookState.vasp,
  useThreshold: () => hookState.threshold,
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
    hookState.vasp = { vasp: { address: 'GWALLET', name: 'My VASP', jurisdiction: 'US' } }
    hookState.threshold = { threshold: 1_000_000_000n, loading: false } // 100 units
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
})

describe('Submit Payment attestation preview', () => {
  const typeAmount = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { name: 'amount', value } })

  /** Renders and waits for the balance fetch, so its state update lands inside act(). */
  const renderPage = async () => {
    render(<NewPaymentPage />)
    await waitFor(() => expect(screen.getByTestId('balance').textContent).toContain('Available:'))
  }

  beforeEach(() => {
    getAssetBalance.mockReset()
    getAssetBalance.mockResolvedValue(1_000_000_000_000n)
    hookState.vasp = { vasp: { address: 'GWALLET', name: 'My VASP', jurisdiction: 'US' } }
    hookState.threshold = { threshold: 1_000_000_000n, loading: false } // 100 units of XLM
  })

  it('says the payment settles immediately below the threshold', async () => {
    await renderPage()
    typeAmount('2.5')

    const preview = screen.getByTestId('attestation-preview')
    expect(preview.textContent).toMatch(/settles immediately/i)
    expect(preview.textContent).toContain('100 XLM for US')
  })

  it('warns that an attestation is required at exactly the threshold', async () => {
    await renderPage()
    typeAmount('100')

    const preview = screen.getByTestId('attestation-preview')
    expect(preview.textContent).toMatch(/attestation required/i)
    expect(preview.textContent).toContain('100 XLM for US')
    expect(preview.textContent).toContain('held in escrow')
  })

  it('warns that an attestation is required above the threshold', async () => {
    await renderPage()
    typeAmount('250.5')

    expect(screen.getByTestId('attestation-preview').textContent).toMatch(/attestation required/i)
  })

  it('fails closed when no threshold rule exists (0 by default)', async () => {
    hookState.threshold = { threshold: 0n, loading: false }
    await renderPage()
    typeAmount('0.01')

    expect(screen.getByTestId('attestation-preview').textContent).toMatch(/attestation required/i)
  })

  it('does not claim either state while the threshold is still loading', async () => {
    hookState.threshold = { threshold: null, loading: true }
    await renderPage()
    typeAmount('2.5')

    const preview = screen.getByTestId('attestation-preview')
    expect(preview.textContent).toMatch(/checking the travel rule threshold/i)
    expect(preview.textContent).not.toMatch(/attestation required|settles immediately/i)
  })

  it('shows nothing before an amount is entered', async () => {
    await renderPage()

    expect(screen.queryByTestId('attestation-preview')).toBeNull()
  })

  it('shows nothing when the connected wallet is not a registered VASP', async () => {
    // A jurisdiction is what selects the threshold; without one there is no rule to preview.
    hookState.vasp = { vasp: null }
    await renderPage()
    typeAmount('2.5')

    expect(screen.queryByTestId('attestation-preview')).toBeNull()
  })
})
