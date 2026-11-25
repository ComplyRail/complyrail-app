import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PaymentDetail } from '@/app/payments/view/PaymentDetail'

const state = vi.hoisted(() => ({
  events: [] as Array<{
    id: string
    ledger: number
    timestamp: number
    txHash: string
    type: 'att_sub' | 'att_amd' | 'pay_sub'
    subject: string
    description: string
    details?: Record<string, string>
  }>,
  auditEventsLoading: false,
  auditEventsError: null as string | null,
  auditEventsTruncated: false,
  payment: {
    id: '42',
    fromVasp: 'GFROM',
    toVasp: 'GTO',
    beneficiary: 'GBENEFICIARY',
    asset: 'CASSET',
    amount: '10000000',
    status: 'released',
    requiresAttestation: true,
    attestationHash: 'bb'.repeat(32),
    ivmsVersion: 'IVMS101.2023',
    attestedAt: 200,
    createdAt: 100,
    createdLedger: 10,
    expiresAt: 9999,
  },
}))

vi.mock('@/lib/hooks', () => ({
  useAdmin: () => ({ admin: null }),
  useAuditEvents: () => ({
    events: state.events,
    loading: state.auditEventsLoading,
    error: state.auditEventsError,
    truncated: state.auditEventsTruncated,
  }),
  useLedgerClock: () => ({ now: 1_000, source: 'ledger', loading: false }),
  usePayment: () => ({ payment: state.payment, loading: false, error: null, reload: vi.fn() }),
  useVasp: () => ({ vasp: null }),
}))

vi.mock('@/components/WalletProvider', () => ({ useWallet: () => ({ address: undefined }) }))
vi.mock('@/components/Notice', () => ({
  ExplorerLink: () => null,
  TxStatus: () => null,
  useTx: () => ({ pending: false, error: null, done: null, txHash: null, run: vi.fn() }),
}))
vi.mock('@/components/ClockWarning', () => ({ ClockWarning: () => null }))
vi.mock('@/lib/config', () => ({ ASSET_DECIMALS: 7, assetSymbol: () => 'XLM' }))

describe('PaymentDetail attestation history', () => {
  beforeEach(() => {
    state.events = [
      {
        id: 'event-latest',
        ledger: 30,
        timestamp: 300,
        txHash: 'tx-latest',
        type: 'att_sub',
        subject: '42',
        description: 'Attestation submitted',
        details: { hash: 'bb'.repeat(32), ivms_version: 'IVMS101.2023' },
      },
      {
        id: 'event-earlier',
        ledger: 20,
        timestamp: 200,
        txHash: 'tx-earlier',
        type: 'att_sub',
        subject: '42',
        description: 'Attestation submitted',
        details: { hash: 'aa'.repeat(32), ivms_version: 'IVMS101.2019' },
      },
      {
        id: 'event-other-payment',
        ledger: 10,
        timestamp: 100,
        txHash: 'tx-other',
        type: 'att_sub',
        subject: '99',
        description: 'Attestation submitted',
        details: { hash: 'cc'.repeat(32), ivms_version: 'IVMS101.2019' },
      },
    ]
    state.auditEventsLoading = false
    state.auditEventsError = null
    state.auditEventsTruncated = false
  })

  it('shows each attestation hash and its IVMS version in chronological order', () => {
    render(<PaymentDetail id="42" />)

    const history = screen.getByRole('list', { name: 'Attestation history' })
    const entries = within(history).getAllByRole('listitem')

    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('aa'.repeat(32))
    expect(entries[0]).toHaveTextContent('IVMS101.2019')
    expect(entries[1]).toHaveTextContent('bb'.repeat(32))
    expect(entries[1]).toHaveTextContent('IVMS101.2023')
    expect(screen.queryByText('cc'.repeat(32))).not.toBeInTheDocument()
  })
})
