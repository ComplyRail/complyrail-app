'use client'

import { useEffect, useRef, useState } from 'react'

type CopyState = 'idle' | 'copied' | 'error'

/** Copies a value and reports success or failure without navigating away. */
export function CopyButton({
  value,
  label = 'value',
  className = '',
}: {
  value: string
  /** Describes what is copied, for the accessible name ("Copy VASP encryption key"). */
  label?: string
  className?: string
}) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available')
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('error')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2_000)
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={`px-2 py-1 rounded border border-border text-xs hover:bg-muted ${className}`}
      >
        {state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : 'Copy'}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? `${label} copied` : state === 'error' ? `Could not copy ${label}` : ''}
      </span>
    </>
  )
}
