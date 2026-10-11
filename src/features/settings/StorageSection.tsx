import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HardDrive, Lock } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ProgressBar } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import { db } from '../../db/database'
import { formatBytes } from '../../lib/time'
import { getFileStore } from '../../services/storage/fileStore'
import { getStorageEstimate, requestPersistentStorage, type StorageEstimateInfo } from '../../services/storage/quota'
import { SettingsSection } from './SettingsSection'

export function StorageSection() {
  const [estimate, setEstimate] = useState<StorageEstimateInfo | null | undefined>(undefined)
  const counts = useLiveQuery(async () => {
    const live = <T extends { deletedAt: number | null }>(r: T) => r.deletedAt === null
    const [notebooks, pages, documents, annotations] = await Promise.all([
      db.notebooks.filter(live).count(),
      db.pages.filter(live).count(),
      db.documents.filter(live).count(),
      db.annotations.filter(live).count(),
    ])
    return { notebooks, pages, documents, annotations }
  }, [])

  const refresh = () => getStorageEstimate().then(setEstimate)
  useEffect(() => {
    void refresh()
  }, [])

  const requestPersist = async () => {
    const granted = await requestPersistentStorage()
    await refresh()
    if (granted) toast.success('Storage is now protected from automatic cleanup.')
    else toast.warning('Your browser did not grant persistent storage. Installing Notivra as an app or using it more often can help — keep exporting backups.')
  }

  const pct = estimate && estimate.quota > 0 ? (estimate.usage / estimate.quota) * 100 : 0

  return (
    <SettingsSection id="storage" title="Storage on this device">
      {estimate === undefined ? (
        <p className="text-sm text-muted">Checking storage…</p>
      ) : estimate === null ? (
        <p className="text-sm text-muted">This browser does not report storage usage.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <HardDrive className="size-4 text-muted" /> {formatBytes(estimate.usage)} used
            </span>
            <span className="text-muted">of {formatBytes(estimate.quota)} available to Notivra</span>
          </div>
          <ProgressBar value={pct} label="Storage used" />
          {pct > 80 && (
            <p className="text-sm text-warning">Storage is nearly full. Delete unused PDFs or empty the trash to avoid save failures.</p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
            <span className="flex items-center gap-2">
              <Lock className="size-4 text-muted" />
              {estimate.persisted ? 'Protected from automatic cleanup' : 'Browser may clear this data under storage pressure'}
            </span>
            {!estimate.persisted && (
              <Button size="sm" variant="secondary" onClick={requestPersist}>
                Request protection
              </Button>
            )}
          </div>
        </div>
      )}
      {counts && (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[
            ['Notebooks', counts.notebooks],
            ['Pages', counts.pages],
            ['PDFs', counts.documents],
            ['Annotations', counts.annotations],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-2 px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-muted">PDF files are stored {getFileStore().kind === 'native' ? "in the app's private folder" : 'in browser storage'}.</p>
    </SettingsSection>
  )
}
