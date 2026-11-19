import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('ExplorerLink', () => {
  it('renders a link when the network has an explorer', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ explorerBase: 'https://stellar.expert/explorer/testnet' }))
    const { ExplorerLink } = await import('@/components/Notice')
    render(<ExplorerLink kind="tx" id="abc" />)
    expect(screen.getByRole('link', { name: 'abc' })).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/tx/abc',
    )
  })

  it('shows an unknown-network label and no link when there is no explorer', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ explorerBase: null }))
    const { ExplorerLink } = await import('@/components/Notice')
    render(<ExplorerLink kind="tx" id="abc" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('(unknown network)')).toBeInTheDocument()
  })
})
