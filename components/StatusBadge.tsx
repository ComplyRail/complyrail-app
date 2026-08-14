'use client'

import { VaspStatus, PaymentStatus } from '@/lib/types'

interface StatusBadgeProps {
  status: VaspStatus | PaymentStatus | string
  type?: 'vasp' | 'payment'
}

export function StatusBadge({ status, type = 'payment' }: StatusBadgeProps) {
  let bgColor = 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'
  let text = status

  if (type === 'vasp') {
    switch (status) {
      case VaspStatus.Active:
        bgColor = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
        text = '✓ Active'
        break
      case VaspStatus.Suspended:
        bgColor = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
        text = '⚠ Suspended'
        break
      case VaspStatus.Revoked:
        bgColor = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
        text = '✕ Revoked'
        break
    }
  } else if (type === 'payment') {
    switch (status) {
      case PaymentStatus.Released:
        bgColor = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
        text = '✓ Released'
        break
      case PaymentStatus.Pending:
        bgColor = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
        text = '⧗ Pending'
        break
      case PaymentStatus.Held:
        bgColor = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
        text = '⏸ Held'
        break
      case PaymentStatus.Rejected:
        bgColor = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
        text = '✕ Rejected'
        break
    }
  }

  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${bgColor}`}>
      {text}
    </span>
  )
}
