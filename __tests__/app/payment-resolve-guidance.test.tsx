import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PaymentDetail } from '@/app/payments/view/PaymentDetail'
import { PaymentStatus, type PaymentRecord } from '@/lib/types'

// Hooks and transaction helpers are mocked; these snapshots cover the resolve card copy only.
const currentPayment = vi.fn()
const reload = vi.fn()

vi.mock('@/lib/hooks', () => ({
  usePayment: () => ({ payment: currentPayment(), loading: false, error: null, reload }),
  useLedgerClock: () => ({ now: 1_700_000_000, source: 'ledger', loading: false }),
  useVasp: () => ({ vasp: undefined, loading: false, error: null }),
  useAdmin: () => ({ admin: 'GADMIN', loading: false, error: null }),
}))
vi.mock('@/components/WalletProvider', () => ({
  useWallet: () => ({ address: 'GTOVASP' }),
}))
vi.mock('@/components/Notice', () => ({
  ExplorerLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TxStatus: () => null,
  useTx: () => ({ run: vi.fn(), pending: false, error: null, done: null, txHash: null }),
}))
vi.mock('@/app/payments/view/IvmsDecryptPanel', () => ({ IvmsDecryptPanel: () => null }))
vi.mock('@/lib/config', () => ({ assetSymbol: () => 'XLM' }))
vi.mock('@/lib/format', () => ({ formatAddress: (a: string) => a, fromUnits: (u: string) => u }))
vi.mock('@/lib/ivms', () => ({ verifyIvmsPayload: vi.fn() }))
vi.mock('@/lib/ivms-crypto', () => ({ sealIvmsPayload: vi.fn() }))
vi.mock('@/lib/contract', () => ({
  buildIvmsPayload: vi.fn(),
  canonicalJson: vi.fn(),
  reclaimExpired: vi.fn(),
  rejectPayment: vi.fn(),
  releasePayment: vi.fn(),
  sha256Hex: vi.fn(),
  submitAttestation: vi.fn(),
}))

const basePayment: PaymentRecord = {
  id: '7',
  fromVasp: 'GFROM',
  toVasp: 'GTOVASP',
  beneficiary: 'GBENEFICIARY',
  asset: 'CXLM',
  amount: '10000000',
  status: PaymentStatus.Pending,
  requiresAttestation: true,
  attestationHash: 'a'.repeat(64),
  createdAt: 1_700_000_000,
  createdLedger: 1,
  expiresAt: 1_800_000_000,
}

function renderResolveCard(overrides: Partial<PaymentRecord>) {
  currentPayment.mockReturnValue({ ...basePayment, ...overrides })
  render(<PaymentDetail id={basePayment.id} />)
  return screen.getByRole('heading', { name: 'Resolve payment' }).parentElement as HTMLElement
}

function resolveSnapshot(card: HTMLElement) {
  const guidance = card.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim()
  const payloadCheck = card.querySelector('#received-payload') ? 'shown' : 'hidden'
  const release = screen.getByRole('button', { name: 'Release to beneficiary' })
  return `guidance=${guidance} | payloadCheck=${payloadCheck} | release=${
    release.hasAttribute('disabled') ? 'disabled' : 'enabled'
  }`
}

describe('PaymentDetail resolve guidance', () => {
  it('shows the hash check for a payment that requires an attestation', () => {
    expect(
      resolveSnapshot(
        renderResolveCard({ requiresAttestation: true, attestationHash: 'a'.repeat(64) }),
      ),
    ).toMatchInlineSnapshot(
      `"guidance=Check the IVMS101 payload you received matches the on-chain hash, then release or reject. | payloadCheck=shown | release=disabled"`,
    )
  })

  it('omits the hash check for a payment that does not require an attestation', () => {
    expect(
      resolveSnapshot(renderResolveCard({ requiresAttestation: false, attestationHash: undefined })),
    ).toMatchInlineSnapshot(
      `"guidance=Confirm the payment details with the originating VASP, then release or reject. | payloadCheck=hidden | release=enabled"`,
    )
  })
})
