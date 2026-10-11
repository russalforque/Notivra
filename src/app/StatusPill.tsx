import { AlertCircle, CheckCircle2, CloudOff, HardDrive, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useOnline } from '../hooks/useOnline'
import { cn } from '../lib/cn'
import { useGlobalSaveState } from '../services/saveStatus'
import { useSyncSnapshot } from '../services/sync/syncStore'

/**
 * One honest status line: local save state first (most important), then sync state.
 * "Saved on this device" is deliberately distinct from "Synced" — local data is not a backup.
 */
export function StatusPill({ compact = false }: { compact?: boolean }) {
  const save = useGlobalSaveState()
  const sync = useSyncSnapshot()
  const online = useOnline()

  let icon = <HardDrive className="size-4" aria-hidden />
  let text = 'Saved on this device'
  let tone = 'text-muted'

  if (save.state === 'error') {
    icon = <AlertCircle className="size-4" aria-hidden />
    text = 'Not saved — action needed'
    tone = 'text-danger'
  } else if (save.state === 'saving' || save.state === 'unsaved') {
    icon = <Loader2 className="size-4 animate-spin" aria-hidden />
    text = 'Saving…'
  } else if (sync.phase === 'conflict') {
    icon = <TriangleAlert className="size-4" aria-hidden />
    text = `${sync.conflictCount} sync conflict${sync.conflictCount === 1 ? '' : 's'}`
    tone = 'text-warning'
  } else if (sync.phase === 'syncing') {
    icon = <RefreshCw className="size-4 animate-spin" aria-hidden />
    text = 'Syncing…'
  } else if (sync.phase === 'error') {
    icon = <AlertCircle className="size-4" aria-hidden />
    text = 'Sync paused — will retry'
    tone = 'text-warning'
  } else if (sync.phase === 'idle' && !online) {
    icon = <CloudOff className="size-4" aria-hidden />
    text = sync.pendingCount > 0 ? `Offline · ${sync.pendingCount} to sync` : 'Offline · all synced'
  } else if (sync.phase === 'idle') {
    if (sync.pendingCount > 0) {
      icon = <RefreshCw className="size-4" aria-hidden />
      text = `${sync.pendingCount} change${sync.pendingCount === 1 ? '' : 's'} waiting to sync`
    } else {
      icon = <CheckCircle2 className="size-4" aria-hidden />
      text = 'Synced'
      tone = 'text-success'
    }
  }

  return (
    <Link
      to="/settings#sync"
      role="status"
      aria-live="polite"
      title={save.error ?? sync.error ?? text}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-surface-2',
        tone,
      )}
    >
      {icon}
      <span className={cn('truncate', compact && 'sr-only')}>{text}</span>
    </Link>
  )
}
