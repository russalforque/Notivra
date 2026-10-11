import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { db } from '../../db/database'
import { guardStorage } from '../../lib/errors'
import { base64ToBytes, bytesToBase64 } from '../../lib/base64'
import { now } from '../../lib/time'

/**
 * Platform-neutral storage for large binaries (PDF originals). Structured data lives in
 * IndexedDB; binaries go here so the native app can keep them out of the WebView quota.
 */
export interface FileStore {
  readonly kind: 'indexeddb' | 'native'
  put(key: string, bytes: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  remove(key: string): Promise<void>
  has(key: string): Promise<boolean>
}

export class IndexedDbFileStore implements FileStore {
  readonly kind = 'indexeddb' as const

  async put(key: string, bytes: Uint8Array): Promise<void> {
    // Copy into a standalone ArrayBuffer so we never persist a view over a larger buffer.
    const copy = bytes.slice().buffer
    await guardStorage(() => db.files.put({ key, bytes: copy, size: bytes.byteLength, createdAt: now() }))
  }

  async get(key: string): Promise<Uint8Array | null> {
    const row = await db.files.get(key)
    return row ? new Uint8Array(row.bytes) : null
  }

  async remove(key: string): Promise<void> {
    await db.files.delete(key)
  }

  async has(key: string): Promise<boolean> {
    return (await db.files.where('key').equals(key).count()) > 0
  }
}

const NATIVE_DIR = 'notivra-files'
// Base64 chunks must be a multiple of 3 bytes so concatenated chunks decode correctly.
const WRITE_CHUNK_BYTES = 3 * 512 * 1024

/**
 * Android/iOS store backed by the app's private data directory. Writes go to a temp file
 * which is renamed into place, so an interrupted write never leaves a truncated original.
 */
export class NativeFileStore implements FileStore {
  readonly kind = 'native' as const

  private path(key: string): string {
    return `${NATIVE_DIR}/${key}.bin`
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const finalPath = this.path(key)
    const tmpPath = `${finalPath}.tmp`
    try {
      const first = bytesToBase64(bytes.subarray(0, WRITE_CHUNK_BYTES))
      await Filesystem.writeFile({ path: tmpPath, data: first, directory: Directory.Data, recursive: true })
      for (let offset = WRITE_CHUNK_BYTES; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
        const data = bytesToBase64(bytes.subarray(offset, offset + WRITE_CHUNK_BYTES))
        await Filesystem.appendFile({ path: tmpPath, data, directory: Directory.Data })
      }
      await Filesystem.rename({ from: tmpPath, to: finalPath, directory: Directory.Data, toDirectory: Directory.Data })
    } catch (error) {
      await Filesystem.deleteFile({ path: tmpPath, directory: Directory.Data }).catch(() => undefined)
      throw error
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await Filesystem.readFile({ path: this.path(key), directory: Directory.Data })
      if (typeof result.data === 'string') return base64ToBytes(result.data)
      return new Uint8Array(await result.data.arrayBuffer())
    } catch {
      return null
    }
  }

  async remove(key: string): Promise<void> {
    await Filesystem.deleteFile({ path: this.path(key), directory: Directory.Data }).catch(() => undefined)
  }

  async has(key: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: this.path(key), directory: Directory.Data })
      return true
    } catch {
      return false
    }
  }
}

let instance: FileStore | null = null

export function getFileStore(): FileStore {
  if (!instance) instance = Capacitor.isNativePlatform() ? new NativeFileStore() : new IndexedDbFileStore()
  return instance
}

/** Test seam. */
export function setFileStore(store: FileStore | null): void {
  instance = store
}

/** Saves a user-facing export (PDF, backup) — a download on web, the Documents folder on Android. */
export async function saveExport(fileName: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const path = `Notivra/${fileName}`
    await Filesystem.writeFile({
      path,
      data: bytesToBase64(bytes),
      directory: Directory.Documents,
      recursive: true,
    })
    return `Documents/${path}`
  }
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return fileName
}

