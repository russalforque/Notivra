import { useSyncExternalStore } from 'react'

/**
 * Observable sync state for the UI.
 * - `unconfigured`: this build has no cloud backend configured.
 * - `signed-out`: cloud available but the user is a guest (data lives only on this device).
 * - `idle` / `syncing` / `error` / `conflict`: signed in.
 */
export type SyncPhase = 'unconfigured' | 'signed-out' | 'idle' | 'syncing' | 'error' | 'conflict'

export interface SyncSnapshot {
  phase: SyncPhase
  pendingCount: number
  conflictCount: number
  lastSyncAt: number | null
  error: string | null
  email: string | null
}

let snapshot: SyncSnapshot = {
  phase: 'unconfigured',
  pendingCount: 0,
  conflictCount: 0,
  lastSyncAt: null,
  error: null,
  email: null,
}
const listeners = new Set<() => void>()

export function setSyncSnapshot(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((l) => l())
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useSyncSnapshot(): SyncSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}
