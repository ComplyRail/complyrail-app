import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ConfigValidationResult } from '@/lib/config'

const DEPLOYED_ID = 'CA5T254NPONJHMOA6UWKRPKW2UI3IUOQ6TWUQGP2NFPLAZWOSCVYXS5Q'
const OTHER_ID = 'C' + 'B'.repeat(55)

async function loadBanner(configValidation: ConfigValidationResult) {
  vi.resetModules()
  vi.doMock('@/lib/config', () => ({
    configValidation,
    explorerBase: 'https://stellar.expert/explorer/testnet',
    isContractConfigured: true,
  }))
  const { ConfigNoticeBanner } = await import('@/components/Notice')
  return ConfigNoticeBanner
}

describe('ConfigNoticeBanner', () => {
  it('renders nothing when configuration is valid with no warnings', async () => {
    const ConfigNoticeBanner = await loadBanner({
      valid: true,
      errors: [],
      warnings: [],
      contractMismatch: false,
    })
    const { container } = render(<ConfigNoticeBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a notice banner when NEXT_PUBLIC_CONTRACT_ID differs from the deployment record', async () => {
    const ConfigNoticeBanner = await loadBanner({
      valid: true,
      errors: [],
      warnings: [
        {
          field: 'contractId',
          severity: 'warning',
          code: 'contract_mismatch',
          message: `NEXT_PUBLIC_CONTRACT_ID (${OTHER_ID}) differs from the deployment record (${DEPLOYED_ID}).`,
        },
      ],
      contractMismatch: true,
    })
    render(<ConfigNoticeBanner />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/Configuration notice:/i)
    expect(status).toHaveTextContent(OTHER_ID)
    expect(status).toHaveTextContent(DEPLOYED_ID)
  })

  it('renders an alert banner when configuration has validation errors', async () => {
    const ConfigNoticeBanner = await loadBanner({
      valid: false,
      errors: [
        {
          field: 'rpcUrl',
          severity: 'error',
          code: 'invalid_rpc_url',
          message: 'Invalid RPC URL "not-a-url": must be a valid http:// or https:// URL.',
        },
        {
          field: 'networkPassphrase',
          severity: 'error',
          code: 'invalid_network_passphrase',
          message: 'Invalid network passphrase "": must be a non-empty single-line string without leading or trailing whitespace.',
        },
      ],
      warnings: [],
      contractMismatch: false,
    })
    render(<ConfigNoticeBanner />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/Configuration error:/i)
    expect(alert).toHaveTextContent(/Invalid RPC URL/i)
    expect(alert).toHaveTextContent(/Invalid network passphrase/i)
  })
})
