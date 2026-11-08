'use client'

import { useCallback, useEffect, useState } from 'react'
import * as api from './contract'
import { isContractConfigured } from './config'
import type { Role } from './rbac'
import type { AuditEvent, PaymentRecord, ThresholdRow, VaspEntry } from './types'

interface AsyncState<T> {
  data: T
  loading: boolean
  error: string | null
  reload: () => void
}

/** Runs `fn` on mount and whenever `key` changes; exposes `reload` after writes. */
function useContractQuery<T>(fn: () => Promise<T>, initial: T, key: string): AsyncState<T> {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!isContractConfigured) {
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
  }, [key, tick])

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

/** Role of the connected wallet, derived from on-chain state. */
export function useRole(address?: string): { role: Role; loading: boolean } {
  const q = useContractQuery<Role>(
    async () => {
      if (!address) return 'viewer'
      if ((await api.getAdmin()) === address) return 'admin'
      const vasp = await api.getVasp(address)
      return vasp ? 'vasp' : 'viewer'
    },
    'viewer',
    `role:${address ?? ''}`,
  )
  return { role: q.data, loading: q.loading }
}
