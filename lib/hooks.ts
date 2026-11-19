'use client'

import { useCallback, useContext, useEffect, useState } from 'react'
import * as api from './contract'
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

export function usePayments() {
  const q = useContractQuery<PaymentRecord[]>(() => api.listPayments(), [], 'payments')
  return { payments: q.data, loading: q.loading, error: q.error, reload: q.reload }
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
  const q = useContractQuery<AuditEvent[]>(api.listAuditEvents, [], 'events')
  return { events: q.data, loading: q.loading, error: q.error, reload: q.reload }
}

export function useAdmin() {
  const q = useContractQuery<string | null>(api.getAdmin, null, 'admin')
  return { admin: q.data, loading: q.loading, error: q.error }
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
