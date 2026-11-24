import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const SAVED = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const OTHER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'
const STORAGE_KEY = 'complyrail:wallet'

const { kit, clearClientCache } = vi.hoisted(() => ({
  kit: {
    init: vi.fn(),
    setWallet: vi.fn(),
    fetchAddress: vi.fn(),
    authModal: vi.fn(),
    signTransaction: vi.fn(),
    disconnect: vi.fn(),
    selectedModule: { productId: 'freighter' },
  },
  clearClientCache: vi.fn(),
}))

vi.mock('@creit.tech/stellar-wallets-kit/sdk', () => ({ StellarWalletsKit: kit }))
vi.mock('@creit.tech/stellar-wallets-kit/modules/utils', () => ({ defaultModules: () => [] }))
vi.mock('@creit.tech/stellar-wallets-kit/types', () => ({ Networks: { TESTNET: 'testnet' } }))
vi.mock('@/lib/config', () => ({ config: { networkPassphrase: 'Test SDF Network ; September 2015' } }))
vi.mock('@/lib/contract', () => ({ clearClientCache }))

import { WalletProvider, useWallet } from '@/components/WalletProvider'

function Probe() {
  const { address, error, signer } = useWallet()
  return (
    <div>
      <span data-testid="address">{address ?? 'none'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
      <span data-testid="signer">{signer?.publicKey ?? 'none'}</span>
    </div>
  )
}

function saveSession(address = SAVED) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ walletId: 'freighter', address }))
}

function renderProvider() {
  return render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  )
}

describe('WalletProvider session restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('restores the saved session when the wallet exposes the same address', async () => {
    saveSession()
    kit.fetchAddress.mockResolvedValue({ address: SAVED })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(SAVED))
    expect(kit.setWallet).toHaveBeenCalledWith('freighter')
    expect(screen.getByTestId('signer').textContent).toBe(SAVED)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('clears a stale session when the wallet exposes a different address', async () => {
    saveSession()
    kit.fetchAddress.mockResolvedValue({ address: OTHER })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/out of date/i))
    expect(screen.getByTestId('address').textContent).toBe('none')
    expect(screen.getByTestId('signer').textContent).toBe('none')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
