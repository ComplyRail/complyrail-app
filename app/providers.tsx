'use client'

import { WalletProvider } from '@/components/WalletProvider'
import { RoleProvider } from '@/components/RoleProvider'
import { Header } from '@/components/Header'
import { ConfigNoticeBanner, NotDeployedBanner } from '@/components/Notice'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <RoleProvider>
        <Header />
        <NotDeployedBanner />
        <ConfigNoticeBanner />
        {children}
      </RoleProvider>
    </WalletProvider>
  )
}
