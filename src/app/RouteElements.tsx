import { Suspense, type ReactNode } from 'react'
import { Link, useRouteError } from 'react-router'
import { Spinner } from '../components/ui/misc'

export function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner className="h-full" />}>{children}</Suspense>
}

export function RouteError() {
  const error = useRouteError()
  console.error(error)
  const isChunkError = error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message)
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">{isChunkError ? 'Notivra was updated' : 'Something went wrong'}</h1>
      <p className="max-w-md text-sm text-muted">
        {isChunkError
          ? 'Reload to load the latest version. Your notes are safe on this device.'
          : 'This screen failed to load. Your saved notes are not affected.'}
      </p>
      <div className="flex gap-3">
        <button type="button" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-fg" onClick={() => window.location.reload()}>
          Reload
        </button>
        <Link to="/" className="rounded-xl border border-border px-4 py-2 text-sm font-medium">
          Go home
        </Link>
      </div>
    </div>
  )
}

export function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-3 inline-block font-medium text-primary hover:underline">
        Go home
      </Link>
    </div>
  )
}
