'use client'

import { WalletProvider } from '@/components/WalletProvider'
import { RoleProvider } from '@/components/RoleProvider'
import { Header } from '@/components/Header'
import { NotDeployedBanner } from '@/components/Notice'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <RoleProvider>
        <Header />
        <NotDeployedBanner />
        {children}
      </RoleProvider>
    </WalletProvider>
  )
}
