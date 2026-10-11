import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CheckCircle2, CloudOff, LogOut, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { Field, Input } from '../../components/ui/Field'
import { toast } from '../../components/ui/toast'
import { db } from '../../db/database'
import { tableFor } from '../../db/repository'
import type { ConflictRecord, SyncEntity } from '../../db/types'
import { useOnline } from '../../hooks/useOnline'
import { formatRelative } from '../../lib/time'
import { SyncEngine } from '../../services/sync/engine'
import { signIn, signOut, signUp, syncNow } from '../../services/sync/syncService'
import { useSyncSnapshot } from '../../services/sync/syncStore'
import { SettingsSection } from './SettingsSection'

export function AccountSection() {
  const sync = useSyncSnapshot()
  const online = useOnline()
  const confirm = useConfirm()

  return (
    <SettingsSection
      id="sync"
      title="Account & sync"
      description="Optional. Without an account Notivra works fully offline on this device. With an account, notebooks, PDFs and study progress sync between your devices."
    >
      {sync.phase === 'unconfigured' && (
        <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
          <CloudOff className="mt-0.5 size-5 shrink-0 text-muted" />
          <p className="text-muted">Cloud sync is not configured in this build. Everything works offline on this device — use backups to move or protect your data.</p>
        </div>
      )}

      {sync.phase === 'signed-out' && <AuthForm online={online} />}

      {sync.email && sync.phase !== 'signed-out' && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3 text-sm">
            {sync.phase === 'error' ? (
              <AlertTriangle className="size-5 text-warning" />
            ) : sync.phase === 'syncing' ? (
              <RefreshCw className="size-5 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="size-5 text-success" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{sync.email}</p>
              <p className="text-muted">
                {sync.phase === 'syncing'
                  ? 'Syncing…'
                  : !online
                    ? `Offline — ${sync.pendingCount} change${sync.pendingCount === 1 ? '' : 's'} will sync when you reconnect`
                    : sync.pendingCount > 0
                      ? `${sync.pendingCount} change${sync.pendingCount === 1 ? '' : 's'} waiting to sync`
                      : 'Everything is synced'}
                {sync.lastSyncAt && ` · last sync ${formatRelative(sync.lastSyncAt)}`}
              </p>
            </div>
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} disabled={!online || sync.phase === 'syncing'} onClick={() => void syncNow()}>
              Sync now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<LogOut className="size-4" />}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Sign out?',
                  message:
                    sync.pendingCount > 0
                      ? `${sync.pendingCount} change(s) have not been synced yet. They stay on this device and will sync when you sign in again.`
                      : 'Your notes stay on this device. Sign in again to resume syncing.',
                  confirmLabel: 'Sign out',
                })
                if (ok) await signOut()
              }}
            >
              Sign out
            </Button>
          </div>
          {sync.error && (
            <p role="alert" className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
              {sync.error}
            </p>
          )}
          <ConflictList />
        </>
      )}
      <p className="text-xs text-muted">Syncing is not a substitute for backups: deleting something syncs the deletion to every device. Keep exporting backups.</p>
    </SettingsSection>
  )
}

function AuthForm({ online }: { online: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') await signIn(email.trim(), password)
      else {
        const { needsConfirmation } = await signUp(email.trim(), password)
        if (needsConfirmation) toast.info('Check your email to confirm your account, then sign in.')
      }
    } catch (err) {
      setError((err as Error).message || 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
      <p className="text-sm text-muted">
        {mode === 'signin' ? 'Sign in to sync this device.' : 'Create an account. Notes already on this device will be uploaded to it.'}
      </p>
      <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!online && <p className="text-sm text-muted">You’re offline. Signing in needs an internet connection.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={!online}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
        <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create an account instead' : 'I already have an account'}
        </button>
      </div>
    </form>
  )
}

const ENTITY_LABELS: Record<SyncEntity, string> = {
  subjects: 'Subject',
  folders: 'Folder',
  notebooks: 'Notebook',
  pages: 'Notebook page',
  documents: 'PDF',
  annotations: 'PDF annotation',
  studySets: 'Study set',
  studyItems: 'Study item',
  studySessions: 'Study session',
  xpEvents: 'XP record',
  userAchievements: 'Achievement',
}

function describe(conflict: ConflictRecord, local: Record<string, unknown> | undefined): string {
  const pick = (r: Record<string, unknown> | undefined) => (r?.title ?? r?.name ?? r?.prompt ?? r?.plainText ?? r?.plain_text ?? '') as string
  const text = pick(local) || pick(conflict.remote)
  return text ? `“${String(text).slice(0, 60)}”` : ''
}

function ConflictList() {
  const conflicts = useLiveQuery(async () => {
    const list = await db.conflicts.toArray()
    return Promise.all(list.map(async (c) => ({ conflict: c, local: (await tableFor(c.entity).get(c.entityId)) as unknown as Record<string, unknown> | undefined })))
  }, [])
  if (!conflicts || conflicts.length === 0) return null

  const resolve = async (key: string, choice: 'local' | 'remote') => {
    try {
      if (choice === 'local') await SyncEngine.keepLocal(key)
      else await SyncEngine.takeRemote(key)
      void syncNow()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="rounded-xl border border-warning/40 p-3">
      <h3 className="flex items-center gap-2 font-semibold text-warning">
        <AlertTriangle className="size-4" /> {conflicts.length} item{conflicts.length === 1 ? '' : 's'} changed on two devices
      </h3>
      <p className="mt-1 text-sm text-muted">Nothing was overwritten. Choose which version to keep for each item.</p>
      <ul className="mt-3 divide-y divide-border">
        {conflicts.map(({ conflict, local }) => (
          <li key={conflict.key} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{ENTITY_LABELS[conflict.entity]}</span> {describe(conflict, local)}
              <span className="block text-xs text-muted">
                This device: edited {local?.updatedAt ? formatRelative(local.updatedAt as number) : '—'} · Cloud: edited{' '}
                {conflict.remote.updated_at ? formatRelative(conflict.remote.updated_at as number) : '—'}
              </span>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void resolve(conflict.key, 'remote')}>
              Use cloud version
            </Button>
            <Button size="sm" onClick={() => void resolve(conflict.key, 'local')}>
              Keep this device’s
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
