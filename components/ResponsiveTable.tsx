'use client'

import { Fragment, type ReactNode } from 'react'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  /** Extra classes for the table cell only. */
  className?: string
}

interface ResponsiveTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  rowClassName?: (row: T) => string
  /** Optional extra content shown under a row (table: extra row; card: extra block). */
  expandedRow?: (row: T) => ReactNode | null
}

/**
 * Renders the same rows two ways so no layout needs horizontal page scroll:
 *  - below `md`: one card per row, each cell labelled with its column header;
 *  - `md` and up: a conventional table inside its own overflow container.
 * Both views read from the same `rows` and `columns`, so data and actions
 * stay identical.
 */
export function ResponsiveTable<T>({ rows, columns, rowKey, rowClassName, expandedRow }: ResponsiveTableProps<T>) {
  return (
    <>
      <div className="hidden md:block md:bg-card md:border md:border-border md:rounded-lg md:overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map(col => (
                <th key={col.header} className="px-6 py-3 text-left text-sm font-semibold">{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <Fragment key={rowKey(row)}>
                <tr className={`border-b border-border hover:bg-muted/50 ${rowClassName?.(row) ?? ''}`}>
                  {columns.map(col => (
                    <td key={col.header} className={`px-6 py-4 ${col.className ?? ''}`}>{col.cell(row)}</td>
                  ))}
                </tr>
                {expandedRow && expandedRow(row) && (
                  <tr className="border-b border-border bg-muted/30">
                    <td colSpan={columns.length} className="px-6 py-4">{expandedRow(row)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden space-y-3">
        {rows.map(row => (
          <li key={rowKey(row)} className={`bg-card border border-border rounded-lg p-4 space-y-2 text-sm ${rowClassName?.(row) ?? ''}`}>
            {columns.map(col => (
              <div key={col.header} className="flex justify-between items-start gap-4">
                <span className="text-muted-foreground shrink-0">{col.header}</span>
                <span className={`text-right min-w-0 break-words ${col.className ?? ''}`}>{col.cell(row)}</span>
              </div>
            ))}
            {expandedRow && expandedRow(row) && (
              <div className="pt-3 border-t border-border">{expandedRow(row)}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
