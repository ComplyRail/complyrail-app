import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CopyablePrefix, CopyableValue } from '@/components/CopyableValue'

const writeText = vi.fn()

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

describe('CopyableValue', () => {
  it('truncates the display but copies the complete hash', async () => {
    const hash = 'a'.repeat(64)
    render(<CopyableValue value={hash} label="Copy attestation hash" />)

    expect(screen.getByTitle(hash).textContent).toBe(`${hash.slice(0, 6)}...${hash.slice(-6)}`)
    fireEvent.click(screen.getByRole('button', { name: `Copy attestation hash: ${hash}` }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(hash))
    expect(screen.getByText('✓ Copied')).toBeInTheDocument()
  })

  it('copies the full address when a link is used as the display', async () => {
    const address = `G${'A'.repeat(55)}`
    render(
      <CopyableValue value={address} variant="address" label="Copy address">
        <a href="/vasps">linked address</a>
      </CopyableValue>,
    )

    fireEvent.click(screen.getByRole('button', { name: `Copy address: ${address}` }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(address))
  })

  it('supports prefix-only truncation for git SHAs', () => {
    const sha = 'abcdef1234567890'
    render(<CopyablePrefix value={sha} leading={7} label="Copy commit" />)

    expect(screen.getByTitle(sha).textContent).toBe('abcdef1...')
  })
})
