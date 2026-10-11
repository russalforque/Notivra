/**
 * Minimal holder for the signed-in account id. Kept outside React so repositories can
 * stamp ownership without importing auth/UI code. `null` means guest (offline-only) mode.
 */
let currentOwnerId: string | null = null
const listeners = new Set<() => void>()

export function getOwnerId(): string | null {
  return currentOwnerId
}

export function setOwnerId(ownerId: string | null): void {
  if (ownerId === currentOwnerId) return
  currentOwnerId = ownerId
  listeners.forEach((l) => l())
}

export function subscribeOwner(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
