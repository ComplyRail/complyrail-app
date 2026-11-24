'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { config } from '@/lib/config'
import { clearClientCache, type Signer } from '@/lib/contract'

interface WalletState {
  address?: string
  connecting: boolean
  error?: string
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  /** Signer for contract writes, or undefined when no wallet is connected. */
  signer?: Signer
}

const WalletContext = createContext<WalletState | null>(null)

const STORAGE_KEY = 'complyrail:wallet'

// Loaded lazily: the kit touches `window` and must never run during SSR.
type Kit = typeof import('@creit.tech/stellar-wallets-kit/sdk').StellarWalletsKit

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const kitRef = useRef<Kit | null>(null)
  const [address, setAddress] = useState<string>()
  const [walletId, setWalletId] = useState<string>()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string>()

  const loadKit = useCallback(async (): Promise<Kit> => {
    if (kitRef.current) return kitRef.current
    const [{ StellarWalletsKit }, { defaultModules }, { Networks }] = await Promise.all([
      import('@creit.tech/stellar-wallets-kit/sdk'),
      import('@creit.tech/stellar-wallets-kit/modules/utils'),
      import('@creit.tech/stellar-wallets-kit/types'),
    ])
    StellarWalletsKit.init({ modules: defaultModules(), network: Networks.TESTNET })
    kitRef.current = StellarWalletsKit
    return StellarWalletsKit
  }, [])

  // Restore a previous session.
  useEffect(() => {
    let cancelled = false
    let saved: { walletId: string; address: string } | null = null
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (parsed && typeof parsed.walletId === 'string' && typeof parsed.address === 'string') saved = parsed
    } catch {
      /* storage unavailable */
    }
    if (!saved) return
    const session = saved

    const forgetSavedSession = () => {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        return
      }
    }

    loadKit()
      .then(async kit => {
        kit.setWallet(session.walletId)
        const { address: current } = await kit.fetchAddress()
        if (cancelled) return
        if (current !== session.address) {
          forgetSavedSession()
          setError('Your saved wallet session is out of date. Reconnect your wallet to continue.')
          return
        }
        setWalletId(session.walletId)
        setAddress(session.address)
      })
      .catch(() => {
        if (cancelled) return
        forgetSavedSession()
        setError('Could not restore your wallet session. Reconnect your wallet to continue.')
      })

    return () => {
      cancelled = true
    }
  }, [loadKit])

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(undefined)
    try {
      const kit = await loadKit()
      const { address } = await kit.authModal()
      const id = kit.selectedModule.productId
      setWalletId(id)
      setAddress(address)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ walletId: id, address }))
      } catch {
        /* storage unavailable */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet connection cancelled')
    } finally {
      setConnecting(false)
    }
  }, [loadKit])

  const disconnect = useCallback(async () => {
    try {
      await kitRef.current?.disconnect()
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* storage unavailable */
    }
    clearClientCache()
    setWalletId(undefined)
    setAddress(undefined)
  }, [])

  const signer = useMemo<Signer | undefined>(() => {
    if (!address || !walletId) return undefined
    return {
      publicKey: address,
      walletId,
      signTransaction: async (xdr: string) => {
        const kit = await loadKit()
        return kit.signTransaction(xdr, { networkPassphrase: config.networkPassphrase, address })
      },
    }
  }, [address, walletId, loadKit])

  const value = useMemo(
    () => ({ address, connecting, error, connect, disconnect, signer }),
    [address, connecting, error, connect, disconnect, signer],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>')
  return ctx
}
