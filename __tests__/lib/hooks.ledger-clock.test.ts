import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import * as api from '@/lib/contract'
import { useLedgerClock } from '@/lib/hooks'

vi.mock('@/lib/contract', () => ({ getLedgerTime: vi.fn() }))
vi.mock('@/lib/config', () => ({ isContractConfigured: true }))

const nowSec = () => Date.now() / 1000

describe('useLedgerClock', () => {
  beforeEach(() => {
    vi.mocked(api.getLedgerTime).mockReset()
  })

  it('uses ledger time even when the browser clock is far off', async () => {
    const ledger = nowSec() + 3600 // ledger is one hour ahead of this browser
    vi.mocked(api.getLedgerTime).mockResolvedValue(ledger)

    const { result } = renderHook(() => useLedgerClock())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('ledger')
    expect(Math.abs(result.current.now - ledger)).toBeLessThan(5)
  })

  it('falls back to the browser clock and reports it when RPC fails', async () => {
    vi.mocked(api.getLedgerTime).mockRejectedValue(new Error('RPC down'))

    const { result } = renderHook(() => useLedgerClock())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('browser')
    expect(Math.abs(result.current.now - nowSec())).toBeLessThan(5)
  })
})
