import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  listPaymentsPage: vi.fn(),
  getPayment: vi.fn(),
}))

vi.mock('@/lib/config', () => ({ isContractConfigured: true }))
vi.mock('@/lib/contract', () => ({
  listPaymentsPage: (...args: unknown[]) => api.listPaymentsPage(...args),
  getPayment: (...args: unknown[]) => api.getPayment(...args),
}))

import {
  invalidatePaymentQueries,
  invalidateQueries,
  paymentQueryKey,
  usePayment,
  usePayments,
} from '@/lib/hooks'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  api.listPaymentsPage.mockReset().mockResolvedValue({ payments: [], nextCursor: 0, total: 0 })
  api.getPayment.mockReset().mockResolvedValue(null)
})

describe('query invalidation', () => {
  it('refetches the payments list and the payment detail after a payment write', async () => {
    const list = renderHook(() => usePayments())
    const detail = renderHook(() => usePayment('7'))

    await waitFor(() => expect(list.result.current.loading).toBe(false))
    await waitFor(() => expect(detail.result.current.loading).toBe(false))
    expect(api.listPaymentsPage).toHaveBeenCalledTimes(1)
    expect(api.getPayment).toHaveBeenCalledTimes(1)

    act(() => invalidatePaymentQueries('7'))

    await waitFor(() => expect(api.listPaymentsPage).toHaveBeenCalledTimes(2))
    expect(api.getPayment).toHaveBeenCalledTimes(2)
  })

  it('replaces the list data with what the refetch returns', async () => {
    const list = renderHook(() => usePayments())
    await waitFor(() => expect(list.result.current.loading).toBe(false))
    expect(list.result.current.payments).toHaveLength(0)

    api.listPaymentsPage.mockResolvedValue({
      payments: [
        {
          id: '1',
          fromVasp: 'GFROM',
          toVasp: 'GTO',
          beneficiary: 'GBEN',
          asset: 'CXLM',
          amount: '1',
          status: 'released',
          requiresAttestation: false,
          createdAt: 1,
          createdLedger: 1,
          expiresAt: 2,
        },
      ],
      nextCursor: 0,
      total: 1,
    })
    act(() => invalidateQueries('payments'))

    await waitFor(() => expect(list.result.current.payments).toHaveLength(1))
    expect(list.result.current.total).toBe(1)
  })

  it('leaves queries with other names alone', async () => {
    const list = renderHook(() => usePayments())
    await waitFor(() => expect(list.result.current.loading).toBe(false))

    act(() => invalidateQueries('vasps', 'thresholds'))

    await flush()
    expect(api.listPaymentsPage).toHaveBeenCalledTimes(1)
  })

  it('ignores writes for a payment id nobody is viewing', async () => {
    const detail = renderHook(() => usePayment('7'))
    await waitFor(() => expect(detail.result.current.loading).toBe(false))

    act(() => invalidateQueries(paymentQueryKey('8')))
    await flush()

    expect(api.getPayment).toHaveBeenCalledTimes(1)
  })

  it('stops refetching after the component unmounts', async () => {
    const list = renderHook(() => usePayments())
    await waitFor(() => expect(list.result.current.loading).toBe(false))
    list.unmount()

    act(() => invalidatePaymentQueries('7'))
    await flush()

    expect(api.listPaymentsPage).toHaveBeenCalledTimes(1)
  })
})
