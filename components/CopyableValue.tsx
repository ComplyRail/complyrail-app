'use client'

import { useEffect, useState } from 'react'
import { formatAddress, formatHash, truncateIdentifier } from '@/lib/format'

/**
 * An identifier shown with the shared truncation rule and a button that copies
 * the complete value. Pass `children` to keep an existing link as the display.
 */
export function CopyableValue({
  value,
  variant = 'hash',
  label,
  children,
  className = '',
}: {
  value: string
  variant?: 'address' | 'hash'
  label?: string
  children?: React.ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => setCopied(false), [value])
  const copyLabel = label ?? (variant === 'address' ? 'Copy address' : 'Copy hash')
  const display = children ?? (variant === 'address' ? formatAddress(value) : formatHash(value))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="font-mono" title={value}>{display}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`${copyLabel}: ${value}`}
        title={copied ? 'Copied' : copyLabel}
        className="px-1 text-xs text-muted-foreground hover:text-primary"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </span>
  )
}

/** Prefix-only form used for git SHAs and the home page's connected address. */
export function CopyablePrefix({
  value,
  leading,
  label,
  children,
  className,
}: {
  value: string
  leading: number
  label: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <CopyableValue
      value={value}
      label={label}
      className={className}
      children={children ?? truncateIdentifier(value, leading, 0)}
    />
  )
}
