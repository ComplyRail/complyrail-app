import { createContext } from 'react'
import type { Role } from './types'

export interface SharedRole {
  /** Wallet the role was fetched for. */
  address: string | undefined
  role: Role
  loading: boolean
}

/** Set by RoleProvider. Null when no provider is mounted. */
export const RoleContext = createContext<SharedRole | null>(null)
