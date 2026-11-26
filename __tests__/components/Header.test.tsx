import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Header } from '@/components/Header'

vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({
    address: null,
    connecting: false,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks', () => ({
  useRole: () => ({ role: 'inactive-vasp' }),
}))

vi.mock('@/lib/format', () => ({
  formatAddress: (address: string) => address,
}))

describe('Header mobile navigation', () => {
  it('exposes menu state and moves focus into and out of the menu', async () => {
    render(<Header />)

    const menuButton = screen.getByRole('button', { name: 'Menu' })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveAttribute('aria-controls', 'mobile-navigation')

    menuButton.focus()
    fireEvent.click(menuButton)

    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => {
      expect(within(document.getElementById('mobile-navigation')!).getByRole('link', { name: 'VASPs' })).toHaveFocus()
    })

    fireEvent.keyDown(within(document.getElementById('mobile-navigation')!).getByRole('link', { name: 'VASPs' }), { key: 'Escape' })

    await waitFor(() => {
      expect(menuButton).toHaveAttribute('aria-expanded', 'false')
      expect(menuButton).toHaveFocus()
    })
  })
})
