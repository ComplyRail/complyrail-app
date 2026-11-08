'use client'

import { WalletProvider } from '@/components/WalletProvider'
import { Header } from '@/components/Header'
import { NotDeployedBanner } from '@/components/Notice'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <Header />
      <NotDeployedBanner />
      {children}
    </WalletProvider>
  )
}
