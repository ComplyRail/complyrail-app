import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const SAVED = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const OTHER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

const { kit, clearClientCache } = vi.hoisted(() => ({
  kit: {
    init: vi.fn(),
    setWallet: vi.fn(),
    fetchAddress: vi.fn(),
    disconnect: vi.fn(),
    authModal: vi.fn(),
    signTransaction: vi.fn(),
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

const STORAGE_KEY = 'complyrail:wallet'

function Probe() {
  const { address, connecting, error, connect, disconnect, signer } = useWallet()
  return (
    <div>
      <span data-testid="address">{address ?? 'none'}</span>
      <span data-testid="connecting">{String(connecting)}</span>
      <span data-testid="error">{error ?? 'none'}</span>
      <span data-testid="signer">{signer?.publicKey ?? 'none'}</span>
      <button onClick={connect}>Connect</button>
      <button onClick={disconnect}>Disconnect</button>
    </div>
  )
}

function renderProvider() {
  return render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  )
}

function saveSession(walletId = 'freighter', address = SAVED) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ walletId, address }))
}

describe('WalletProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    kit.fetchAddress.mockResolvedValue({ address: SAVED })
    kit.authModal.mockResolvedValue({ address: SAVED })
    kit.disconnect.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('session restore', () => {
    it('restores a saved session after the wallet confirms the same address', async () => {
      saveSession()
      renderProvider()

      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(SAVED))
      expect(kit.setWallet).toHaveBeenCalledWith('freighter')
      expect(kit.fetchAddress).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('signer').textContent).toBe(SAVED)
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    })

    it('discards a session when the wallet now exposes a different address', async () => {
      saveSession('freighter', SAVED)
      kit.fetchAddress.mockResolvedValue({ address: OTHER })
      renderProvider()

      await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/out of date/i))
      expect(screen.getByTestId('address').textContent).toBe('none')
      expect(screen.getByTestId('signer').textContent).toBe('none')
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('does not show the saved address while the wallet is still being queried', async () => {
      saveSession()
      let confirmAddress: (value: { address: string }) => void = () => undefined
      kit.fetchAddress.mockReturnValue(new Promise(resolve => { confirmAddress = resolve }))
      renderProvider()

      expect(screen.getByTestId('address').textContent).toBe('none')
      confirmAddress({ address: SAVED })
      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(SAVED))
    })

    it('discards a session the wallet can no longer resolve', async () => {
      saveSession()
      kit.fetchAddress.mockRejectedValue(new Error('wallet locked'))
      renderProvider()

      await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/could not restore/i))
      expect(screen.getByTestId('address').textContent).toBe('none')
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('ignores malformed saved JSON instead of failing to render', async () => {
      localStorage.setItem(STORAGE_KEY, '{not json')
      renderProvider()

      expect(screen.getByTestId('address').textContent).toBe('none')
      expect(screen.getByTestId('error').textContent).toBe('none')
      expect(kit.init).not.toHaveBeenCalled()
    })

    it('ignores a saved value that is missing the wallet id or address', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ address: SAVED }))
      renderProvider()

      expect(screen.getByTestId('address').textContent).toBe('none')
      expect(kit.setWallet).not.toHaveBeenCalled()
    })

    it('still renders when storage cannot be read', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })
      renderProvider()

      expect(screen.getByTestId('address').textContent).toBe('none')
      expect(screen.getByTestId('error').textContent).toBe('none')
      expect(kit.setWallet).not.toHaveBeenCalled()
    })
  })

  describe('connect', () => {
    it('shows the wallet address and builds a signer', async () => {
      renderProvider()
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(SAVED))
      expect(screen.getByTestId('signer').textContent).toBe(SAVED)
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
        walletId: 'freighter',
        address: SAVED,
      })
    })

    it('keeps the wallet connected when the browser refuses to persist the session', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded')
      })
      renderProvider()
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(SAVED))
      expect(screen.getByTestId('error').textContent).toBe('none')
    })

    it('surfaces a wallet cancellation without leaving the connecting state set', async () => {
      kit.authModal.mockRejectedValue(new Error('Request cancelled in wallet'))
      renderProvider()
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

      await waitFor(() => expect(screen.getByTestId('error').textContent).toMatch(/cancelled/i))
      expect(screen.getByTestId('connecting').textContent).toBe('false')
      expect(screen.getByTestId('address').textContent).toBe('none')
    })
  })

  describe('disconnect', () => {
    it('clears the wallet, the saved session and the contract client cache', async () => {
      saveSession()
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(SAVED))

      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe('none'))
      expect(kit.disconnect).toHaveBeenCalledTimes(1)
      expect(clearClientCache).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
      expect(screen.getByTestId('signer').textContent).toBe('none')
    })

    it('still clears local state when the wallet or storage throws', async () => {
      saveSession()
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(SAVED))
      kit.disconnect.mockRejectedValue(new Error('wallet gone'))
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage disabled')
      })

      fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

      await waitFor(() => expect(screen.getByTestId('address').textContent).toBe('none'))
      expect(clearClientCache).toHaveBeenCalledTimes(1)
    })
  })
})
