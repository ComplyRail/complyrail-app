import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PaymentDetail } from '@/app/payments/view/PaymentDetail'
import { usePayments } from '@/lib/hooks'
import { FIELD_LIMITS } from '@/lib/limits'
import { PaymentStatus } from '@/lib/types'

const api = vi.hoisted(() => ({
  getPayment: vi.fn(),
  listPaymentsPage: vi.fn(),
  getVasp: vi.fn(),
  getAdmin: vi.fn(),
  getLedgerTime: vi.fn(),
  releasePayment: vi.fn(),
  rejectPayment: vi.fn(),
}))

vi.mock('@/lib/config', () => ({
  assetSymbol: () => 'XLM',
  ASSET_DECIMALS: 7,
  isContractConfigured: true,
  explorerBase: 'https://stellar.expert/explorer/testnet',
  config: {},
}))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({
    address: 'GTO',
    signer: { publicKey: 'GTO', walletId: 'test', signTransaction: vi.fn() },
    connect: vi.fn(),
  }),
}))
vi.mock('@/lib/ivms-crypto', () => ({ sealIvmsPayload: vi.fn() }))
vi.mock('@/lib/ivms', () => ({ verifyIvmsPayload: vi.fn() }))
vi.mock('@/lib/contract', () => ({
  getPayment: (...args: unknown[]) => api.getPayment(...args),
  listPaymentsPage: (...args: unknown[]) => api.listPaymentsPage(...args),
  getVasp: (...args: unknown[]) => api.getVasp(...args),
  getAdmin: (...args: unknown[]) => api.getAdmin(...args),
  getLedgerTime: (...args: unknown[]) => api.getLedgerTime(...args),
  releasePayment: (...args: unknown[]) => api.releasePayment(...args),
  rejectPayment: (...args: unknown[]) => api.rejectPayment(...args),
  reclaimExpired: vi.fn(),
  submitAttestation: vi.fn(),
  buildIvmsPayload: vi.fn(),
  canonicalJson: vi.fn(),
  sha256Hex: vi.fn(),
  TxFailedError: class TxFailedError extends Error {},
}))

const PAYMENT = {
  id: '7',
  fromVasp: 'GFROM',
  toVasp: 'GTO',
  beneficiary: 'GBEN',
  asset: 'CXLM',
  amount: '10000000',
  status: PaymentStatus.Pending,
  requiresAttestation: false,
  createdAt: 1_700_000_000,
  createdLedger: 1,
  expiresAt: 4_000_000_000,
}

const OTHER_PAYMENT = { ...PAYMENT, id: '8', status: PaymentStatus.Released }

/** Also mounts the payments list, which lives on another route in the real app. */
function PaymentsListProbe() {
  const { payments } = usePayments()
  return <p data-testid="list-count">{payments.length}</p>
}

function renderDetail() {
  return render(
    <>
      <PaymentDetail id="7" />
      <PaymentsListProbe />
    </>,
  )
}

/** The release card only enables release after the operator confirms the override. */
async function allowRelease() {
  const override = await screen.findByRole('checkbox', { name: /override/i })
  fireEvent.click(override)
  const release = screen.getByRole('button', { name: /release to beneficiary/i })
  await waitFor(() => expect(release).not.toBeDisabled())
  return release
}

beforeEach(() => {
  api.getPayment.mockReset().mockResolvedValue(PAYMENT)
  api.listPaymentsPage
    .mockReset()
    .mockResolvedValueOnce({ payments: [PAYMENT], nextCursor: 0, total: 1 })
    .mockResolvedValue({ payments: [PAYMENT, OTHER_PAYMENT], nextCursor: 0, total: 2 })
  api.getVasp.mockReset().mockResolvedValue({
    address: 'GTO',
    name: 'Receiving VASP',
    jurisdiction: 'US',
    publicKey: 'ab'.repeat(32),
    status: 'active',
    addedAt: 1,
  })
  api.getAdmin.mockReset().mockResolvedValue('GADMIN')
  api.getLedgerTime.mockReset().mockResolvedValue(Date.now() / 1000)
  api.releasePayment.mockReset().mockResolvedValue(undefined)
  api.rejectPayment.mockReset().mockResolvedValue(undefined)
})

describe('PaymentDetail refreshes the queue after a write', () => {
  it('reloads the payments list and the stat-card counts after a release', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('list-count').textContent).toBe('1'))
    expect(api.listPaymentsPage).toHaveBeenCalledTimes(1)
    expect(api.getPayment).toHaveBeenCalledTimes(1)

    fireEvent.click(await allowRelease())
    await waitFor(() => expect(api.releasePayment).toHaveBeenCalledTimes(1))

    // The detail itself refetches, and so does the list in the sibling component.
    await waitFor(() => expect(api.getPayment).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.listPaymentsPage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('list-count').textContent).toBe('2'))
  })

  it('does not reload anything when the write fails', async () => {
    api.releasePayment.mockRejectedValue(new Error('User rejected the signature'))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('list-count').textContent).toBe('1'))

    fireEvent.click(await allowRelease())
    await screen.findByText(/request cancelled in wallet/i)

    expect(api.getPayment).toHaveBeenCalledTimes(1)
    expect(api.listPaymentsPage).toHaveBeenCalledTimes(1)
  })
})

describe('PaymentDetail rejection reason', () => {
  it('offers common reasons as presets that fill the reason field', async () => {
    renderDetail()
    const preset = await screen.findByRole('button', { name: 'Beneficiary details incomplete' })

    fireEvent.click(preset)

    expect(screen.getByPlaceholderText('Reason')).toHaveValue('Beneficiary details incomplete')
    expect(preset).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Reject' })).not.toBeDisabled()
  })

  it('still accepts a free-text reason', async () => {
    renderDetail()
    await screen.findByRole('checkbox', { name: /override/i })

    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'Duplicate submission' } })

    expect(screen.getByRole('button', { name: 'Reject' })).not.toBeDisabled()
    expect(screen.getByTestId('reason-bytes').textContent).toBe(`20 / ${FIELD_LIMITS.reason} bytes`)
  })

  it('limits the reason to the contract byte length and blocks the write past it', async () => {
    renderDetail()
    await screen.findByRole('checkbox', { name: /override/i })
    const reason = screen.getByPlaceholderText('Reason')

    fireEvent.change(reason, { target: { value: 'a'.repeat(FIELD_LIMITS.reason) } })
    expect(screen.queryByText(/must be at most/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Reject' })).not.toBeDisabled()

    fireEvent.change(reason, { target: { value: 'a'.repeat(FIELD_LIMITS.reason + 1) } })
    expect(screen.getByRole('alert').textContent).toContain(`at most ${FIELD_LIMITS.reason} bytes`)
    expect(screen.getByTestId('reason-bytes').textContent).toBe(`257 / ${FIELD_LIMITS.reason} bytes`)
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
  })

  it('counts multi-byte characters in bytes, not characters', async () => {
    renderDetail()
    await screen.findByRole('checkbox', { name: /override/i })
    // 86 characters, but 258 UTF-8 bytes, so the contract would reject it.
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: '€'.repeat(86) } })

    expect(screen.getByRole('alert').textContent).toContain(`at most ${FIELD_LIMITS.reason} bytes`)
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
  })

  it('sends the chosen reason with the rejection', async () => {
    renderDetail()
    await screen.findByRole('checkbox', { name: /override/i })
    fireEvent.click(screen.getByRole('button', { name: 'Suspected sanctions match' }))

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(api.rejectPayment).toHaveBeenCalledTimes(1))
    expect(api.rejectPayment.mock.calls[0][2]).toBe('Suspected sanctions match')
  })
})
