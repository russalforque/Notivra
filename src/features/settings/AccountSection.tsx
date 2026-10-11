import { CloudOff } from 'lucide-react'
import { useSyncSnapshot } from '../../services/sync/syncStore'
import { SettingsSection } from './SettingsSection'

export function AccountSection() {
  const sync = useSyncSnapshot()
  return (
    <SettingsSection id="sync" title="Account & sync">
      {sync.phase === 'unconfigured' && (
        <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm">
          <CloudOff className="mt-0.5 size-5 shrink-0 text-muted" />
          <p className="text-muted">
            Cloud sync is not configured in this build. Everything works offline on this device — use backups to move or protect your data.
          </p>
        </div>
      )}
    </SettingsSection>
  )
}
