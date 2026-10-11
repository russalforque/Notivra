import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArchiveRestore, DownloadCloud, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { toast } from '../../components/ui/toast'
import { db } from '../../db/database'
import { toUserMessage } from '../../lib/errors'
import { pickFiles, readFileBytes } from '../../lib/filePicker'
import { DAY_MS, formatRelative } from '../../lib/time'
import { useNow } from '../../hooks/useNow'
import {
  backupFileName,
  createBackup,
  parseBackup,
  recordBackupCompleted,
  restoreBackup,
  type ParsedBackup,
} from '../../services/backup/backupService'
import { saveExport } from '../../services/storage/fileStore'
import { SettingsSection } from './SettingsSection'

export function BackupSection() {
  const lastBackupAt = useLiveQuery(async () => ((await db.settings.get('lastBackupAt'))?.value as number | null) ?? null, [])
  const [exporting, setExporting] = useState(false)
  const nowMs = useNow()
  const [pending, setPending] = useState<ParsedBackup | null>(null)
  const [restoring, setRestoring] = useState(false)

  const stale = !lastBackupAt || nowMs - lastBackupAt > 7 * DAY_MS

  const doExport = async () => {
    setExporting(true)
    try {
      const { bytes, manifest } = await createBackup()
      const where = await saveExport(backupFileName({ kind: 'full' }), bytes, 'application/zip')
      await recordBackupCompleted(manifest)
      toast.success(`Backup saved (${where}). Keep it somewhere safe, like cloud storage or a USB drive.`)
    } catch (err) {
      toast.error(toUserMessage(err, 'The backup could not be created. Nothing was changed.'))
    } finally {
      setExporting(false)
    }
  }

  const chooseRestore = async () => {
    try {
      const [file] = await pickFiles('.notivra,application/zip')
      if (!file) return
      setPending(await parseBackup(await readFileBytes(file)))
    } catch (err) {
      toast.error(toUserMessage(err, 'That file could not be read as a backup.'))
    }
  }

  const doRestore = async () => {
    if (!pending) return
    setRestoring(true)
    try {
      const r = await restoreBackup(pending)
      toast.success(`Restore complete: ${r.added} added, ${r.updated} updated, ${r.skipped} already up to date.`)
      setPending(null)
    } catch (err) {
      toast.error(toUserMessage(err, 'Restore failed. Your existing data was not changed.'))
    } finally {
      setRestoring(false)
    }
  }

  const counts = pending?.manifest.counts ?? {}

  return (
    <SettingsSection
      id="backup"
      title="Backup & restore"
      description="Your notes are stored on this device. A browser or phone can lose that data (clearing site data, uninstalling, device loss), so export a backup regularly."
    >
      <div className={`flex items-start gap-3 rounded-xl p-3 text-sm ${stale ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'}`}>
        {stale ? <ShieldAlert className="mt-0.5 size-5 shrink-0" /> : <ShieldCheck className="mt-0.5 size-5 shrink-0" />}
        <p>
          {lastBackupAt
            ? `Last backup file created ${formatRelative(lastBackupAt)}.`
            : 'You have not created a backup file yet.'}
          {stale && ' We recommend exporting a backup at least weekly.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={<DownloadCloud className="size-4" />} loading={exporting} onClick={doExport}>
          Export full backup
        </Button>
        <Button variant="secondary" icon={<ArchiveRestore className="size-4" />} onClick={chooseRestore}>
          Restore from backup…
        </Button>
      </div>
      <p className="text-xs text-muted">
        Backups include notebooks, PDFs and their annotations, study sets and progress. Restoring merges with what is already here:
        newer local edits are never overwritten by older backup data.
      </p>

      <Dialog
        open={!!pending}
        onClose={() => !restoring && setPending(null)}
        dismissible={!restoring}
        title="Restore this backup?"
        description={pending ? `Created ${new Date(pending.manifest.createdAt).toLocaleString()} (app ${pending.manifest.appVersion}).` : undefined}
        footer={
          <>
            <Button variant="secondary" disabled={restoring} onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button loading={restoring} onClick={doRestore}>
              Restore
            </Button>
          </>
        }
      >
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {[
            ['Notebooks', counts.notebooks],
            ['Pages', counts.pages],
            ['PDFs', counts.documents],
            ['Annotations', counts.annotations],
            ['Study sets', counts.studySets],
            ['Study items', counts.studyItems],
          ].map(([label, n]) => (
            <li key={label as string} className="flex justify-between rounded-lg bg-surface-2 px-3 py-2">
              <span className="text-muted">{label}</span>
              <span className="font-medium">{(n as number | undefined) ?? 0}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Items that are newer on this device are kept as they are.</p>
      </Dialog>
    </SettingsSection>
  )
}
