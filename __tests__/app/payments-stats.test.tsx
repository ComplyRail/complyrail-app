import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PaymentsPage from '@/app/payments/page'
import { PaymentStatus } from '@/lib/types'

const { usePaymentsMock } = vi.hoisted(() => ({ usePaymentsMock: vi.fn() }))

vi.mock('@/lib/hooks', () => ({ usePayments: usePaymentsMock }))
vi.mock('@/components/StatusBadge', () => ({ StatusBadge: () => null }))
vi.mock('@/components/ResponsiveTable', () => ({ ResponsiveTable: () => null }))
vi.mock('@/lib/config', () => ({ assetSymbol: (asset: string) => asset }))
vi.mock('@/lib/format', () => ({
  formatAddress: (address: string) => address,
  fromUnits: (amount: string) => amount,
}))

describe('Payment statistics', () => {
  it('counts each loaded payment in exactly one status card', () => {
    usePaymentsMock.mockReturnValue({
      payments: [
        { id: '1', status: PaymentStatus.Pending, requiresAttestation: true, attestationHash: undefined },
        { id: '2', status: PaymentStatus.Pending, requiresAttestation: false },
        { id: '3', status: PaymentStatus.Released },
        { id: '4', status: PaymentStatus.Rejected },
        { id: '5', status: PaymentStatus.Reclaimed },
      ],
      hasMore: false,
      loadMore: vi.fn(),
      loadingMore: false,
      moreError: null,
      loading: false,
      error: null,
    })

    render(<PaymentsPage />)

    const valueFor = (label: string) =>
      Number(screen.getByText(label).nextElementSibling?.textContent)
    const total = valueFor('Total')
    const statusCounts = [
      valueFor('Pending'),
      valueFor('Awaiting attestation'),
      valueFor('Released'),
      valueFor('Rejected'),
      valueFor('Reclaimed'),
    ]

    expect(statusCounts).toEqual([1, 1, 1, 1, 1])
    expect(statusCounts.reduce((sum, count) => sum + count, 0)).toBe(total)
  })
})
