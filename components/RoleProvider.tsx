'use client'

import { useMemo } from 'react'
import { RoleContext } from '@/lib/role-context'
import { useRole } from '@/lib/hooks'
import { useWallet } from '@/components/WalletProvider'

/**
 * Fetches the connected wallet's role once and shares it with every `useRole`
 * call below it, so the header and each page don't repeat the same RPC reads.
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { address } = useWallet()
  // Above the context, so this call performs the fetch.
  const { role, loading } = useRole(address)
  const value = useMemo(() => ({ address, role, loading }), [address, role, loading])
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}
