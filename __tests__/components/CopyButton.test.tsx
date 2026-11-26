import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyButton } from '@/components/CopyButton'

const KEY = 'ab'.repeat(32)

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

describe('CopyButton', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('copies the exact value and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    render(<CopyButton value={KEY} label="VASP encryption key" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy VASP encryption key' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy VASP encryption key' })).toHaveTextContent('Copied'))
    expect(writeText).toHaveBeenCalledWith(KEY)
    expect(screen.getByRole('status')).toHaveTextContent('VASP encryption key copied')
  })

  it('reports a clipboard failure instead of pretending it copied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    setClipboard(writeText)
    render(<CopyButton value={KEY} label="VASP encryption key" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy VASP encryption key' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy VASP encryption key' })).toHaveTextContent('Copy failed'))
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy VASP encryption key')
  })

  it('reports failure when the browser exposes no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    render(<CopyButton value={KEY} label="VASP encryption key" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy VASP encryption key' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy VASP encryption key' })).toHaveTextContent('Copy failed'))
  })
})
