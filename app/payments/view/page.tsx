'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { PaymentDetail } from './PaymentDetail'

// Static export can't pre-render one page per payment id, so the id is a query param.
function View() {
  const id = useSearchParams().get('id') ?? ''
  if (!/^\d+$/.test(id)) {
    return <div className="min-h-screen bg-background p-8 text-center text-red-600">Missing or invalid payment id</div>
  }
  return <PaymentDetail id={id} />
}

export default function PaymentViewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background p-8 text-center text-muted-foreground">Loading…</div>}>
      <View />
    </Suspense>
  )
}
