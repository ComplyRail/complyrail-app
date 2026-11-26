'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const pathname = usePathname()
  const routeName = pathname || 'unknown route'

  useEffect(() => {
    console.error(`Render error on route ${routeName}:`, error)
  }, [error, routeName])

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="mb-3 text-2xl font-bold">This page ran into a problem</h1>
        <p className="mb-6 text-muted-foreground" role="alert">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-border px-5 py-2 font-medium hover:bg-muted"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}
