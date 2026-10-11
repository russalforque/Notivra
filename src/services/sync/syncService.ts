import { liveQuery } from 'dexie'
import { db } from '../../db/database'
import { setOwnerId } from '../../db/session'
import { setRemoteFileFetcher } from '../../features/pdf/documentService'
import { getSetting } from '../settings'
import { supabase } from '../supabase/client'
import { SyncEngine } from './engine'
import { RemoteError, SupabaseRemote } from './remote'
import { getSyncSnapshot, setSyncSnapshot } from './syncStore'

const INTERVAL_MS = 60_000
const AFTER_WRITE_DELAY_MS = 4_000

let engine: SyncEngine | null = null
let running: Promise<void> | null = null
let rerun = false
let started = false
let writeTimer: ReturnType<typeof setTimeout> | null = null

/** Starts auth listening and background sync. Safe to call once at startup. */
export function startSyncService(): void {
  if (started) return
  started = true

  // Live counters for the status pill (work in every mode, including guest).
  liveQuery(async () => ({ pending: await db.syncQueue.count(), conflicts: await db.conflicts.count() })).subscribe({
    next: ({ pending, conflicts }) => {
      const snap = getSyncSnapshot()
      setSyncSnapshot({
        pendingCount: pending,
        conflictCount: conflicts,
        phase: conflicts > 0 && engine ? 'conflict' : snap.phase === 'conflict' ? 'idle' : snap.phase,
      })
      if (engine && pending > 0) scheduleAfterWrite()
    },
  })

  if (!supabase) {
    setSyncSnapshot({ phase: 'unconfigured' })
    return
  }
  setSyncSnapshot({ phase: 'signed-out' })
  supabase.auth.onAuthStateChange((_event, session) => {
    void handleSession(session?.user ?? null)
  })
  void supabase.auth.getSession().then(({ data }) => handleSession(data.session?.user ?? null))

  window.addEventListener('online', () => void syncNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  setInterval(() => void syncNow(), INTERVAL_MS)
}

async function handleSession(user: { id: string; email?: string | null } | null): Promise<void> {
  if (!user || !supabase) {
    engine = null
    setOwnerId(null)
    setRemoteFileFetcher(null)
    setSyncSnapshot({ phase: supabase ? 'signed-out' : 'unconfigured', email: null, error: null })
    return
  }
  if (engine && getSyncSnapshot().email === (user.email ?? null)) return

  // Never mix two accounts' data on one device.
  const previous = await getSetting('syncedAccountId')
  if (previous && previous !== user.id) {
    engine = null
    setSyncSnapshot({
      phase: 'error',
      email: user.email ?? null,
      error: 'This device has notes synced with a different account. Sign out, or export a backup and clear this device before using this account.',
    })
    return
  }

  setOwnerId(user.id)
  engine = new SyncEngine(new SupabaseRemote(supabase), user.id)
  const current = engine
  setRemoteFileFetcher((doc) => current.downloadFile(doc))
  setSyncSnapshot({ phase: 'idle', email: user.email ?? null, error: null, lastSyncAt: await getSetting('lastSyncAt') })
  void syncNow()
}

function scheduleAfterWrite(): void {
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    void syncNow()
  }, AFTER_WRITE_DELAY_MS)
}

/** Runs a sync now (single-flight; also exclusive across tabs when Web Locks exist). */
export function syncNow(): Promise<void> {
  if (!engine) return Promise.resolve()
  if (running) {
    rerun = true
    return running
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve()

  const run = async () => {
    const current = engine
    if (!current) return
    setSyncSnapshot({ phase: 'syncing', error: null })
    try {
      const report = await current.syncOnce()
      const conflicts = await db.conflicts.count()
      setSyncSnapshot({ phase: conflicts > 0 ? 'conflict' : 'idle', lastSyncAt: Date.now(), conflictCount: conflicts, error: report.failed > 0 ? `${report.failed} item(s) will be retried.` : null })
    } catch (error) {
      const offline = error instanceof RemoteError && error.kind === 'network'
      const auth = error instanceof RemoteError && error.kind === 'auth'
      setSyncSnapshot({
        phase: offline ? 'idle' : 'error',
        error: offline ? null : auth ? 'Your session expired. Please sign in again.' : 'Sync failed. Your changes are safe on this device and will be retried.',
      })
    }
  }

  const locked = () =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('notivra-sync', { ifAvailable: true }, async (lock) => {
          if (lock) await run()
        })
      : run()

  running = (async () => {
    do {
      rerun = false
      await locked()
    } while (rerun)
  })().finally(() => {
    running = null
  })
  return running
}

// ───────────── auth helpers for the UI ─────────────

export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Cloud sync is not configured.')
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

export async function signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  if (!supabase) throw new Error('Cloud sync is not configured.')
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  return { needsConfirmation: !data.session }
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}
