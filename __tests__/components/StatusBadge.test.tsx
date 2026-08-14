import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StatusBadge } from '@/components/StatusBadge'
import { VaspStatus, PaymentStatus } from '@/lib/types'

describe('StatusBadge', () => {
  it('renders VASP status badge', () => {
    const { container } = render(<StatusBadge type="vasp" status={VaspStatus.Active} />)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    expect(badge?.textContent).toContain('Active')
  })

  it('renders payment status badge', () => {
    const { container } = render(<StatusBadge type="payment" status={PaymentStatus.Released} />)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    expect(badge?.textContent).toContain('Released')
  })

  it('renders pending payment status', () => {
    const { container } = render(<StatusBadge type="payment" status={PaymentStatus.Pending} />)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    expect(badge?.textContent).toContain('Pending')
  })

  it('renders rejected payment status', () => {
    const { container } = render(<StatusBadge type="payment" status={PaymentStatus.Rejected} />)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    expect(badge?.textContent).toContain('Rejected')
  })

  it('renders suspended VASP status', () => {
    const { container } = render(<StatusBadge type="vasp" status={VaspStatus.Suspended} />)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    expect(badge?.textContent).toContain('Suspended')
  })

  it('applies correct styling with tailwind classes', () => {
    const { container } = render(<StatusBadge type="vasp" status={VaspStatus.Active} />)
    const badge = container.querySelector('span')
    expect(badge?.className).toContain('bg-green-100')
    expect(badge?.className).toContain('rounded-full')
  })

  it('renders unknown status as-is', () => {
    const { container } = render(<StatusBadge type="payment" status="unknown_status" />)
    const badge = container.querySelector('span')
    expect(badge?.textContent).toBe('unknown_status')
  })
})
