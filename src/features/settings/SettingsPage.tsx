import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Monitor, Moon, Sun } from 'lucide-react'
import { PageHeader } from '../../components/ui/misc'
import { SCHEMA_VERSION, db } from '../../db/database'
import { cn } from '../../lib/cn'
import { APP_VERSION } from '../../services/backup/backupService'
import { applyTheme, getThemePreference, setSetting, type ThemePreference } from '../../services/settings'
import { AccountSection } from './AccountSection'
import { BackupSection } from './BackupSection'
import { SettingsSection } from './SettingsSection'
import { StorageSection } from './StorageSection'

export function SettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" description="Appearance, storage, backups and sync." />
      <AppearanceSection />
      <EditorSection />
      <BackupSection />
      <StorageSection />
      <AccountSection />
      <SettingsSection id="about" title="About Notivra">
        <p className="text-sm text-muted">
          Version {APP_VERSION} · data format v{SCHEMA_VERSION}. Notivra works fully offline; an account is only needed for optional cloud
          sync and AI study tools.
        </p>
      </SettingsSection>
    </div>
  )
}

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference)
  const options: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ]
  return (
    <SettingsSection id="appearance" title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={theme === o.id}
            onClick={() => {
              setTheme(o.id)
              applyTheme(o.id)
            }}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium',
              theme === o.id ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-surface-2',
            )}
          >
            <o.icon className="size-5" aria-hidden />
            {o.label}
          </button>
        ))}
      </div>
    </SettingsSection>
  )
}

function EditorSection() {
  const fingerDrawing = useLiveQuery(async () => ((await db.settings.get('fingerDrawing'))?.value as boolean | undefined) ?? true, [])
  return (
    <SettingsSection id="editor" title="Writing">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--primary)]"
          checked={fingerDrawing ?? true}
          onChange={(e) => void setSetting('fingerDrawing', e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">Draw with finger</span>
          <span className="block text-sm text-muted">
            Turn off if you use a stylus: fingers will then scroll the page, and only the pen writes. A stylus always writes.
          </span>
        </span>
      </label>
    </SettingsSection>
  )
}
