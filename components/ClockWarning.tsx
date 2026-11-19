import type { LedgerClock } from '@/lib/hooks'

/** Shown when expiry times are based on the browser clock because RPC is unavailable. */
export function ClockWarning({ clock }: { clock: LedgerClock }) {
  if (clock.loading || clock.source === 'ledger') return null
  return (
    <div role="alert" className="mb-4 px-4 py-3 rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-900">
      Ledger time is unavailable, so expiry is calculated from your browser clock, which may be wrong. Do not reclaim
      or treat a payment as expired until this clears.
    </div>
  )
}
