import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
const KEY = '0123456789abcdef'.repeat(4)

const { mocks } = vi.hoisted(() => ({
  mocks: {
    state: { vasp: null as unknown, loading: false, error: null as string | null },
  },
}))

vi.mock('@/lib/hooks', () => ({
  useVasp: () => mocks.state,
  useLedgerClock: () => ({ now: 1_000_000, source: 'ledger', loading: false }),
}))
vi.mock('@/lib/config', () => ({
  explorerBase: 'https://stellar.expert/explorer/testnet',
  config: {},
}))

import { VaspDetail } from '@/app/vasps/view/VaspDetail'

const VASP = {
  address: ADDRESS,
  name: 'Acme VASP',
  jurisdiction: 'US',
  publicKey: KEY,
  status: 'active',
  addedAt: 900_000,
  expiresAt: 2_000_000,
}

describe('VaspDetail', () => {
  beforeEach(() => {
    mocks.state = { vasp: VASP, loading: false, error: null }
  })

  it('shows the full encryption public key and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<VaspDetail address={ADDRESS} />)

    expect(screen.getByText(KEY)).toBeInTheDocument()
    expect(screen.getByText(/encrypt Travel Rule payloads to this key/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy VASP encryption key' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy VASP encryption key' })).toHaveTextContent('Copied'))
  })

  it('does not offer a copy button when the VASP has no key', () => {
    mocks.state = { vasp: { ...VASP, publicKey: '' }, loading: false, error: null }
    render(<VaspDetail address={ADDRESS} />)

    expect(screen.getByText('No encryption key is registered for this VASP.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy VASP encryption key/ })).toBeNull()
  })

  it('shows a loading state and a not-found state', () => {
    mocks.state = { vasp: null, loading: true, error: null }
    const { rerender } = render(<VaspDetail address={ADDRESS} />)
    expect(screen.getByText('Loading from contract…')).toBeInTheDocument()

    mocks.state = { vasp: null, loading: false, error: 'RPC unavailable' }
    rerender(<VaspDetail address={ADDRESS} />)
    expect(screen.getByText(/not found/)).toBeInTheDocument()
  })
})
