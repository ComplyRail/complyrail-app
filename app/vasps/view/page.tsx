'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { isValidStellarAddress } from '@/lib/wallet'
import { VaspDetail } from './VaspDetail'

// Static export can't pre-render one page per VASP address, so the address is a query param.
function View() {
  const address = useSearchParams().get('address') ?? ''
  if (!isValidStellarAddress(address)) {
    return (
      <div className="min-h-screen bg-background p-8 text-center text-red-600">
        Missing or invalid VASP address
      </div>
    )
  }
  return <VaspDetail address={address} />
}

export default function VaspViewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background p-8 text-center text-muted-foreground">Loading…</div>}>
      <View />
    </Suspense>
  )
}
