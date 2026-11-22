'use client'

import { useCallback, useContext, useEffect, useState } from 'react'
import * as api from './contract'
import type { PaymentPage } from './contract'
import { isContractConfigured } from './config'
import { RoleContext } from './role-context'
import type { Role } from './rbac'
import type { AuditEvent, PaymentRecord, ThresholdRow, VaspEntry } from './types'

interface AsyncState<T> {
  data: T
  loading: boolean
  error: string | null
  reload: () => void
}

/** Runs `fn` on mount and whenever `key` changes; exposes `reload` after writes. */
function useContractQuery<T>(fn: () => Promise<T>, initial: T, key: string, enabled = true): AsyncState<T> {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!isContractConfigured || !enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fn()
      .then(d => !cancelled && setData(d))
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, enabled])

  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, loading, error, reload }
}

const LEDGER_POLL_MS = 60_000

export interface LedgerClock {
  /** Current time in unix seconds, based on the latest ledger when available */
  now: number
  /** 'browser' means RPC was unavailable and the browser clock is in use */
  source: 'ledger' | 'browser'
  loading: boolean
}

/**
 * Current time from the Stellar ledger, used for all expiry comparisons. Syncs
 * with RPC on mount and every minute, and keeps the offset in between. If RPC
 * fails, falls back to the browser clock and reports `source: 'browser'`.
 */
export function useLedgerClock(): LedgerClock {
  const [offset, setOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const sync = () => {
      api
        .getLedgerTime()
        .then(t => !cancelled && setOffset(t - Date.now() / 1000))
        .catch(() => !cancelled && setOffset(null))
        .finally(() => !cancelled && setLoading(false))
    }
    sync()
    const id = setInterval(sync, LEDGER_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return {
    now: Date.now() / 1000 + (offset ?? 0),
    source: offset === null ? 'browser' : 'ledger',
    loading,
  }
}

export function useVasps() {
  const q = useContractQuery<VaspEntry[]>(api.listVasps, [], 'vasps')
  return { vasps: q.data, loading: q.loading, error: q.error, reload: q.reload }
}

export function useVasp(address: string) {
  const q = useContractQuery<VaspEntry | null>(
    () => (address ? api.getVasp(address) : Promise.resolve(null)),
    null,
    `vasp:${address}`,
  )
  return { vasp: q.data, loading: q.loading, error: q.error }
}

const EMPTY_PAGE: PaymentPage = { payments: [], nextCursor: 0, total: 0 }

/** Newest-first payments, loaded one page at a time via `loadMore`. */
export function usePayments() {
  const first = useContractQuery<PaymentPage>(() => api.listPaymentsPage(), EMPTY_PAGE, 'payments')
  const [more, setMore] = useState<PaymentRecord[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  // A reload replaces the first page, so drop anything loaded after it.
  useEffect(() => {
    setMore([])
    setCursor(null)
    setMoreError(null)
  }, [first.data])

  const nextCursor = cursor ?? first.data.nextCursor

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await api.listPaymentsPage(nextCursor)
      setMore(m => [...m, ...page.payments])
      setCursor(page.nextCursor)
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor])

  return {
    payments: [...first.data.payments, ...more],
    total: first.data.total ?? 0,
    hasMore: nextCursor > 0,
    loadMore,
    loadingMore,
    moreError,
    loading: first.loading,
    error: first.error,
    reload: first.reload,
  }
}

export function usePayment(paymentId: string) {
  const q = useContractQuery<PaymentRecord | null>(() => api.getPayment(paymentId), null, `payment:${paymentId}`)
  return { payment: q.data, loading: q.loading, error: q.error, reload: q.reload }
}

export function useThresholds() {
  const q = useContractQuery<ThresholdRow[]>(api.listThresholds, [], 'thresholds')
  return { thresholds: q.data, loading: q.loading, error: q.error, reload: q.reload }
}

export function useAuditEvents() {
  const q = useContractQuery<api.AuditEventsResult>(
    api.listAuditEvents,
    { events: [], truncated: false, window: { startLedger: 0, latestLedger: 0, since: 0, fallback: false } },
    'events',
  )
  return {
    events: q.data.events,
    truncated: q.data.truncated,
    window: q.data.window,
    loading: q.loading,
    error: q.error,
    reload: q.reload,
  }
}

export function useThresholdAdmin(address?: string) {
  const q = useContractQuery<boolean>(
    async () => !!address && (await api.getThresholdAdmin()) === address,
    false,
    `threshold-admin:${address ?? ''}`,
  )
  return { isThresholdAdmin: q.data, loading: q.loading }
}

export function useAdmin() {
  const q = useContractQuery<string | null>(api.getAdmin, null, 'admin')
  return { admin: q.data, loading: q.loading, error: q.error, reload: q.reload }
}

export function usePendingAdmin() {
  const q = useContractQuery<string | null>(api.getPendingAdmin, null, 'pending-admin')
  return { pendingAdmin: q.data, loading: q.loading, error: q.error, reload: q.reload }
}

/** Role of a wallet, derived from on-chain state. */
export async function fetchRole(address?: string): Promise<Role> {
  if (!address) return 'viewer'
  if ((await api.getAdmin()) === address) return 'admin'
  const vasp = await api.getVasp(address)
  if (!vasp) return 'viewer'
  return (await api.isVaspActive(address)) ? 'vasp' : 'inactive-vasp'
}

/**
 * Role of the connected wallet, derived from on-chain state. Uses the role
 * shared by RoleProvider when it is for the same wallet; otherwise fetches it.
 */
export function useRole(address?: string): { role: Role; loading: boolean } {
  const shared = useContext(RoleContext)
  const useShared = shared !== null && shared.address === address
  const own = useContractQuery<Role>(
    () => fetchRole(address),
    'viewer',
    `role:${address ?? ''}`,
    !useShared,
  )
  if (useShared) return { role: shared.role, loading: shared.loading }
  return { role: own.data, loading: own.loading }
}
