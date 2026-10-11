import { useSyncExternalStore } from 'react'

/**
 * Global registry of save states from every open editor. Drives the header indicator and
 * the "you have unsaved changes" guard on tab close.
 */
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

interface Entry {
  state: SaveState
  error: string | null
}

const entries = new Map<string, Entry>()
let snapshot: { state: SaveState; error: string | null } = { state: 'saved', error: null }
const listeners = new Set<() => void>()

const severity: Record<SaveState, number> = { saved: 0, saving: 1, unsaved: 2, error: 3 }

function recompute() {
  let worst: Entry = { state: 'saved', error: null }
  for (const e of entries.values()) if (severity[e.state] > severity[worst.state]) worst = e
  if (worst.state !== snapshot.state || worst.error !== snapshot.error) {
    snapshot = { state: worst.state, error: worst.error }
    listeners.forEach((l) => l())
  }
}

export function reportSaveState(sourceId: string, state: SaveState, error: string | null = null): void {
  entries.set(sourceId, { state, error })
  recompute()
}

export function clearSaveState(sourceId: string): void {
  entries.delete(sourceId)
  recompute()
}

export function hasUnsavedWork(): boolean {
  return snapshot.state !== 'saved'
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useGlobalSaveState() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}
