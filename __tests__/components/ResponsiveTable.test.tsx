import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable'

type Row = { id: string; name: string; status: string }

const rows: Row[] = [
  { id: '1', name: 'Acme VASP', status: 'Active' },
  { id: '2', name: 'Beta Exchange', status: 'Suspended' },
]

const columns: Column<Row>[] = [
  { header: 'Name', cell: r => r.name },
  { header: 'Status', cell: r => r.status },
]

describe('ResponsiveTable', () => {
  it('renders the same rows in the table and in the mobile card list', () => {
    const { container } = render(<ResponsiveTable rows={rows} columns={columns} rowKey={r => r.id} />)

    const table = container.querySelector('table')!
    expect(within(table).getAllByRole('row')).toHaveLength(3) // header + 2 rows
    expect(within(table).getByText('Acme VASP')).toBeInTheDocument()

    const cards = container.querySelectorAll('ul > li')
    expect(cards).toHaveLength(2)
    expect(within(cards[1] as HTMLElement).getByText('Beta Exchange')).toBeInTheDocument()
  })

  it('labels every value in a card with its column header', () => {
    const { container } = render(<ResponsiveTable rows={rows} columns={columns} rowKey={r => r.id} />)
    const card = container.querySelector('ul > li') as HTMLElement
    expect(within(card).getByText('Name')).toBeInTheDocument()
    expect(within(card).getByText('Status')).toBeInTheDocument()
    expect(within(card).getByText('Active')).toBeInTheDocument()
  })

  it('hides the table below md and the cards at md and up', () => {
    const { container } = render(<ResponsiveTable rows={rows} columns={columns} rowKey={r => r.id} />)
    expect(container.querySelector('table')!.parentElement).toHaveClass('hidden', 'md:block')
    expect(container.querySelector('ul')).toHaveClass('md:hidden')
  })

  it('applies row classes to both views', () => {
    const { container } = render(
      <ResponsiveTable rows={rows} columns={columns} rowKey={r => r.id}
        rowClassName={r => (r.status === 'Suspended' ? 'bg-yellow-50' : '')} />,
    )
    expect(container.querySelector('tbody tr:nth-child(2)')).toHaveClass('bg-yellow-50')
    expect(container.querySelectorAll('ul > li')[1]).toHaveClass('bg-yellow-50')
  })

  it('shows the expanded row under the matching row in both views only when it returns content', () => {
    render(
      <ResponsiveTable rows={rows} columns={columns} rowKey={r => r.id}
        expandedRow={r => (r.id === '2' ? <button>Renew Beta</button> : null)} />,
    )
    expect(screen.getAllByRole('button', { name: 'Renew Beta' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Renew Acme/ })).toBeNull()
  })
})
