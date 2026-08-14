'use client'

import { useState, useEffect } from 'react'
import { VaspEntry, PaymentRecord, AuditEvent } from './types'
import { mockVasps, mockPayments, mockThresholds, getUserRole, mockAuditEvents } from './mockData'
import { client } from './sdk'

export function useVasps() {
  const [vasps, setVasps] = useState<VaspEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchVasps = async () => {
      try {
        setLoading(true)
        setVasps(mockVasps)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch VASPs')
      } finally {
        setLoading(false)
      }
    }

    fetchVasps()
  }, [])

  return { vasps, loading, error }
}

export function useVasp(address: string) {
  const [vasp, setVasp] = useState<VaspEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchVasp = async () => {
      try {
        setLoading(true)
        const found = mockVasps.find(v => v.address === address)
        setVasp(found || null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch VASP')
      } finally {
        setLoading(false)
      }
    }

    if (address) fetchVasp()
  }, [address])

  return { vasp, loading, error }
}

export function usePayments() {
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchPayments = async () => {
      try {
        setLoading(true)
        setPayments(mockPayments)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch payments')
      } finally {
        setLoading(false)
      }
    }

    fetchPayments()
  }, [])

  return { payments, loading, error }
}

export function usePayment(paymentId: string) {
  const [payment, setPayment] = useState<PaymentRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchPayment = async () => {
      try {
        setLoading(true)
        const found = mockPayments.find(p => p.id === paymentId)
        setPayment(found || null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch payment')
      } finally {
        setLoading(false)
      }
    }

    if (paymentId) fetchPayment()
  }, [paymentId])

  return { payment, loading, error }
}

export function useThresholds() {
  const [thresholds, setThresholds] = useState(mockThresholds)

  return { thresholds }
}

export function useThreshold(asset: string, jurisdiction: string) {
  const key = `${asset}:${jurisdiction}`
  return mockThresholds.get(key)
}

export function useAuditEvents() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true)
        setEvents(mockAuditEvents)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch audit events')
      } finally {
        setLoading(false)
      }
    }

    fetchEvents()
  }, [])

  return { events, loading, error }
}

export function useWalletUser(publicKey?: string) {
  const [user, setUser] = useState(getUserRole(publicKey))

  useEffect(() => {
    setUser(getUserRole(publicKey))
  }, [publicKey])

  return user
}
