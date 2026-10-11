import { db } from '../db/database'

/** Typed key/value settings stored in IndexedDB (device-local, never synced). */
export interface SettingsShape {
  lastBackupAt: number | null
  /** Per-entity server cursor (max server_updated_at seen), used by sync pulls. */
  syncCursors: Record<string, string>
  lastSyncAt: number | null
  /** Account the local data was last synced with — guards against mixing accounts. */
  syncedAccountId: string | null
  fingerDrawing: boolean
  aiConsentAt: number | null
  persistRequested: boolean
}

const DEFAULTS: SettingsShape = {
  lastBackupAt: null,
  syncCursors: {},
  lastSyncAt: null,
  syncedAccountId: null,
  fingerDrawing: true,
  aiConsentAt: null,
  persistRequested: false,
}

export async function getSetting<K extends keyof SettingsShape>(key: K): Promise<SettingsShape[K]> {
  const row = await db.settings.get(key)
  return row ? (row.value as SettingsShape[K]) : DEFAULTS[key]
}

export async function setSetting<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): Promise<void> {
  await db.settings.put({ key, value })
}

export function settingDefault<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
  return DEFAULTS[key]
}

// Theme lives in localStorage so it can be applied before React (and IndexedDB) load.
export type ThemePreference = 'light' | 'dark' | 'system'
const THEME_KEY = 'notivra.theme'

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Private mode: theme just won't persist.
  }
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', !!dark)
}
