import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PaymentsPage from '@/app/payments/page'

vi.mock('next/link', () => ({
  default: ({ href, children, className }: any) => <a href={href} className={className}>{children}</a>,
}))

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}))

vi.mock('@/components/ResponsiveTable', () => ({
  ResponsiveTable: ({ rows, rowKey }: any) => <div data-testid="table">{rows.map((r: any) => <div key={rowKey(r)}>row-{r.id}</div>)}</div>,
}))

vi.mock('@/lib/config', () => ({
  assetSymbol: () => 'XLM',
}))

vi.mock('@/lib/format', () => ({
  formatAddress: (a: string) => a,
  fromUnits: (v: string) => v,
}))

vi.mock('@/lib/hooks', () => ({
  usePayments: () => ({
    payments: Array.from({ length: 100 }, (_, i) => ({
      id: String(i + 1),
      fromVasp: 'GFROM',
      toVasp: 'GTO',
      beneficiary: 'GBEN',
      asset: 'AXLM',
      amount: '10000000',
      status: i < 3 ? 'pending' : 'released',
      requiresAttestation: false,
      attestationHash: undefined,
      createdAt: 1,
    })),
    total: 250,
    hasMore: true,
    loadMore: vi.fn(),
    loadingMore: false,
    moreError: null,
    loading: false,
    error: null,
  }),
}))

describe('PaymentsPage totals', () => {
  it('shows the true total when it exceeds the loaded page size', () => {
    render(<PaymentsPage />)

    expect(screen.getByText('Total').parentElement?.textContent).toContain('250')
    expect(screen.getByText(/Status counts cover the 100 loaded payments/i)).toBeTruthy()
    expect(screen.getByText('Pending').parentElement?.textContent).toContain('3')
  })
})
