import { StorageQuotaError } from '../../lib/errors'

export interface StorageEstimateInfo {
  usage: number
  quota: number
  persisted: boolean
}

export async function getStorageEstimate(): Promise<StorageEstimateInfo | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? Promise.resolve(false),
    ])
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted }
  } catch {
    return null
  }
}

/**
 * Asks the browser not to evict our data under storage pressure. Browsers may silently
 * deny this; the UI must still tell users to keep backups.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** Safety margin so importing a file never consumes the space needed to save notes. */
const RESERVE_BYTES = 20 * 1024 * 1024

/** Throws before a large write that would likely exceed the quota. */
export async function ensureSpaceFor(bytes: number): Promise<void> {
  const estimate = await getStorageEstimate()
  if (!estimate || estimate.quota === 0) return // Unknown: let the write itself report failure.
  const free = estimate.quota - estimate.usage
  if (bytes * 1.1 + RESERVE_BYTES > free) throw new StorageQuotaError()
}
