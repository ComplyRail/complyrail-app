'use client'

import { useEffect, useRef, type ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  /** Plain-language description of what the action will do. */
  consequences: ReactNode
  confirmLabel: string
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}

/** Accessible confirmation overlay for destructive actions. Escape and backdrop clicks cancel. */
export function ConfirmDialog({
  title,
  consequences,
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    // Land keyboard users on the reason field rather than the page behind the overlay.
    panelRef.current?.querySelector<HTMLElement>('input, button')?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) cancelRef.current()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-consequences"
        className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="text-xl font-semibold">{title}</h2>
        <p id="confirm-dialog-consequences" className="text-sm text-muted-foreground">{consequences}</p>
        {children}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={confirmDisabled}
            className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
