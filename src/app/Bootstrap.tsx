import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { db } from '../db/database'
import { purgeExpiredTrash } from '../features/library/libraryService'
import { seedAchievementCatalog } from '../features/progress/achievements'
import { getSetting, setSetting } from '../services/settings'
import { requestPersistentStorage } from '../services/storage/quota'
import { hasUnsavedWork } from '../services/saveStatus'
import { Spinner } from '../components/ui/misc'
import { startSyncService } from '../services/sync/syncService'

type BootState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

function describeOpenError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? ''
  if (name === 'VersionError' || name === 'UpgradeError') {
    return 'Your saved data was created by a newer version of Notivra. Please update the app. Your data has not been changed.'
  }
  if (name === 'MissingAPIError' || name === 'InvalidStateError') {
    return 'This browser is blocking local storage (for example, a private window with storage disabled). Notivra needs local storage to keep your notes offline.'
  }
  if (name === 'DatabaseClosedError' || name === 'OpenFailedError') {
    return 'Notivra could not open its local database. Close other Notivra tabs and reload.'
  }
  return 'Notivra could not open its local database. Your data has not been changed. Try reloading the page.'
}

/** Opens the local database and runs startup maintenance before rendering the app. */
export function Bootstrap({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BootState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await db.open()
        await seedAchievementCatalog()
        startSyncService()
        if (!cancelled) setState({ kind: 'ready' })
      } catch (error) {
        console.error('Database open failed', error)
        if (!cancelled) setState({ kind: 'error', message: describeOpenError(error) })
        return
      }
      // Non-critical maintenance: failures must never block the app.
      purgeExpiredTrash().catch((e) => console.warn('Trash cleanup failed', e))
      if (!(await getSetting('persistRequested'))) {
        await requestPersistentStorage()
        await setSetting('persistRequested', true)
      }
    })()

    // Another tab upgraded the schema: close so it can proceed, then reload to pick up new code.
    db.on('versionchange', () => {
      db.close()
      if (!hasUnsavedWork()) window.location.reload()
      return false
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  if (state.kind === 'loading') return <Spinner label="Opening your notebooks" className="h-full" />
  if (state.kind === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div role="alert" className="max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
          <AlertTriangle className="mx-auto size-10 text-warning" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Storage unavailable</h1>
          <p className="mt-2 text-sm text-muted">{state.message}</p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-fg"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
