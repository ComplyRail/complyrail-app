import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const WALLET = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'

vi.mock('@/lib/config', () => ({ isContractConfigured: true }))
vi.mock('@/lib/contract', () => ({
  getAdmin: vi.fn(),
  getVasp: vi.fn(),
  isVaspActive: vi.fn(),
}))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7' }),
}))

import * as api from '@/lib/contract'
import { useRole } from '@/lib/hooks'
import { RoleProvider } from '@/components/RoleProvider'

const mocked = vi.mocked(api)

/** Stands in for the header and the five pages that each call useRole. */
function Consumer({ id }: { id: number }) {
  const { role, loading } = useRole(WALLET)
  return <div data-testid={`consumer-${id}`}>{loading ? 'loading' : role}</div>
}

const CONSUMERS = [0, 1, 2, 3, 4]

describe('RoleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.getAdmin.mockResolvedValue('GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H')
    mocked.getVasp.mockResolvedValue({} as never)
    mocked.isVaspActive.mockResolvedValue(true)
  })

  it('issues one admin and one VASP lookup per wallet without the provider', async () => {
    render(
      <>
        {CONSUMERS.map(id => (
          <Consumer key={id} id={id} />
        ))}
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('consumer-0').textContent).toBe('vasp'))
    await waitFor(() => expect(screen.getByTestId('consumer-4').textContent).toBe('vasp'))
    // Baseline: every consumer repeats the lookups.
    expect(mocked.getAdmin.mock.calls.length).toBe(CONSUMERS.length)
    expect(mocked.getVasp.mock.calls.length).toBe(CONSUMERS.length)
  })

  it('issues one admin and one VASP lookup per wallet with the provider', async () => {
    render(
      <RoleProvider>
        {CONSUMERS.map(id => (
          <Consumer key={id} id={id} />
        ))}
      </RoleProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('consumer-0').textContent).toBe('vasp'))
    await waitFor(() => expect(screen.getByTestId('consumer-4').textContent).toBe('vasp'))
    expect(mocked.getAdmin).toHaveBeenCalledTimes(1)
    expect(mocked.getVasp).toHaveBeenCalledTimes(1)
    expect(mocked.isVaspActive).toHaveBeenCalledTimes(1)
  })
})
