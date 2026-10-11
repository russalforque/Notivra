import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { db } from '../../db/database'
import { enqueueSync, tableFor } from '../../db/repository'
import type { EntityMap, SyncedRecord } from '../../db/types'
import { AppError, ValidationError, guardStorage } from '../../lib/errors'
import { sha256Hex } from '../../lib/base64'
import { now } from '../../lib/time'
import { getFileStore } from '../storage/fileStore'
import { setSetting } from '../settings'
import {
  BACKUP_ENTITIES,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupSchemas,
  manifestSchema,
  type BackupEntity,
  type BackupManifest,
} from './backupSchema'

export const APP_VERSION = '0.1.0'
const MAX_BACKUP_BYTES = 1.5 * 1024 * 1024 * 1024

type BackupData = { [E in BackupEntity]: EntityMap[E][] }

export type BackupScope = { kind: 'full' } | { kind: 'notebook'; notebookId: string }

async function collect(scope: BackupScope): Promise<BackupData> {
  if (scope.kind === 'notebook') {
    const notebook = await db.notebooks.get(scope.notebookId)
    if (!notebook) throw new AppError('Notebook not found.')
    const pages = (await db.pages.where('notebookId').equals(notebook.id).toArray()).filter((p) => p.deletedAt === null)
    const subject = notebook.subjectId ? await db.subjects.get(notebook.subjectId) : undefined
    return {
      ...emptyData(),
      notebooks: [{ ...notebook, folderId: null }],
      pages,
      subjects: subject ? [subject] : [],
    }
  }
  const data = emptyData()
  for (const entity of BACKUP_ENTITIES) {
    ;(data[entity] as SyncedRecord[]) = await tableFor(entity).toArray()
  }
  return data
}

function emptyData(): BackupData {
  return Object.fromEntries(BACKUP_ENTITIES.map((e) => [e, []])) as unknown as BackupData
}

/** Builds a backup archive. Nothing is marked "backed up" until the caller confirms the save. */
export async function createBackup(scope: BackupScope = { kind: 'full' }): Promise<{ bytes: Uint8Array; manifest: BackupManifest }> {
  const data = await collect(scope)
  const store = getFileStore()
  const zip: Zippable = {}
  const files: BackupManifest['files'] = []

  for (const doc of data.documents) {
    if (doc.purgedAt !== null) continue
    const bytes = await store.get(doc.fileKey)
    if (!bytes) continue // File only exists in the cloud (or is missing); metadata is still backed up.
    files.push({ key: doc.fileKey, size: bytes.byteLength, sha256: await sha256Hex(bytes) })
    zip[`files/${doc.fileKey}`] = [bytes, { level: 0 }] // PDFs are already compressed.
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now(),
    appVersion: APP_VERSION,
    scope: scope.kind,
    counts: Object.fromEntries(BACKUP_ENTITIES.map((e) => [e, data[e].length])),
    files,
  }
  zip['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  zip['data.json'] = [strToU8(JSON.stringify(data)), { level: 6 }]
  return { bytes: zipSync(zip), manifest }
}

export async function recordBackupCompleted(manifest: BackupManifest): Promise<void> {
  if (manifest.scope === 'full') await setSetting('lastBackupAt', manifest.createdAt)
}

export interface ParsedBackup {
  manifest: BackupManifest
  data: BackupData
  files: Map<string, Uint8Array>
}

/** Unpacks and validates an archive without writing anything. */
export async function parseBackup(bytes: Uint8Array): Promise<ParsedBackup> {
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new ValidationError('This backup is too large to restore on this device.')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new ValidationError('This file is not a valid Notivra backup (it could not be unzipped).')
  }
  const manifestRaw = entries['manifest.json']
  const dataRaw = entries['data.json']
  if (!manifestRaw || !dataRaw) throw new ValidationError('This file is not a Notivra backup (missing manifest or data).')

  const manifestResult = manifestSchema.safeParse(safeJson(manifestRaw))
  if (!manifestResult.success) throw new ValidationError('The backup manifest is invalid or from an unsupported app.')
  const manifest = manifestResult.data
  if (manifest.version > BACKUP_VERSION) {
    throw new ValidationError('This backup was made by a newer version of Notivra. Please update the app first.')
  }

  const rawData = safeJson(dataRaw) as Record<string, unknown>
  if (!rawData || typeof rawData !== 'object') throw new ValidationError('The backup data is unreadable.')
  const data = emptyData()
  for (const entity of BACKUP_ENTITIES) {
    const rows = rawData[entity] ?? []
    if (!Array.isArray(rows)) throw new ValidationError(`The backup section "${entity}" is invalid.`)
    const schema = backupSchemas[entity]
    const parsed: unknown[] = []
    rows.forEach((row, i) => {
      const r = schema.safeParse(row)
      if (!r.success) {
        throw new ValidationError(`The backup is damaged: record ${i + 1} in "${entity}" is invalid (${r.error.issues[0]?.path.join('.')}).`)
      }
      parsed.push(r.data)
    })
    ;(data[entity] as unknown[]) = parsed
  }

  const files = new Map<string, Uint8Array>()
  for (const f of manifest.files) {
    const content = entries[`files/${f.key}`]
    if (!content) throw new ValidationError('The backup is incomplete: a PDF file is missing.')
    if ((await sha256Hex(content)) !== f.sha256) throw new ValidationError('The backup is damaged: a PDF file failed its integrity check.')
    files.set(f.key, content)
  }
  return { manifest, data, files }
}

function safeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(strFromU8(bytes))
  } catch {
    return null
  }
}

export interface RestoreReport {
  added: number
  updated: number
  skipped: number
  files: number
}

/**
 * Merges a backup into the local database.
 *
 * Merge rule: a backup record replaces a local record only if its revision is strictly
 * higher. Local edits made after the backup are never overwritten. Restored changes are
 * queued for sync like any other local change.
 */
export async function restoreBackup(parsed: ParsedBackup): Promise<RestoreReport> {
  const report: RestoreReport = { added: 0, updated: 0, skipped: 0, files: 0 }
  const store = getFileStore()

  // 1) Binaries first: if this fails nothing references them yet (no dangling documents).
  for (const doc of parsed.data.documents) {
    const bytes = parsed.files.get(doc.fileKey)
    if (!bytes) continue
    if (await store.has(doc.fileKey)) continue
    await guardStorage(() => store.put(doc.fileKey, bytes))
    report.files++
  }

  // 2) All records in a single transaction: either the whole restore applies or none of it.
  const tables = [...BACKUP_ENTITIES.map((e) => db.table(e)), db.syncQueue]
  await guardStorage(() =>
    db.transaction('rw', tables, async () => {
      for (const entity of BACKUP_ENTITIES) {
        const table = tableFor(entity)
        for (const incoming of parsed.data[entity] as SyncedRecord[]) {
          const local = (await table.get(incoming.id)) as SyncedRecord | undefined
          if (local && local.rev >= incoming.rev) {
            report.skipped++
            continue
          }
          if (!local && (await violatesUniqueKey(entity, incoming))) {
            report.skipped++
            continue
          }
          const record = {
            ...incoming,
            syncStatus: 'pending',
            // Keep the local server revision if we have one: it's the newest we know of.
            serverRev: local?.serverRev ?? incoming.serverRev,
          } as EntityMap[typeof entity]
          await table.put(record as never)
          await enqueueSync(entity, incoming.id)
          if (local) report.updated++
          else report.added++
        }
      }
    }),
  )
  return report
}

/** XP events and achievements have natural unique keys besides the id; never duplicate them. */
async function violatesUniqueKey(entity: BackupEntity, record: SyncedRecord): Promise<boolean> {
  if (entity === 'xpEvents') {
    const key = (record as EntityMap['xpEvents']).key
    return (await db.xpEvents.where('key').equals(key).count()) > 0
  }
  if (entity === 'userAchievements') {
    const achievementId = (record as EntityMap['userAchievements']).achievementId
    return (await db.userAchievements.where('achievementId').equals(achievementId).count()) > 0
  }
  return false
}

export function backupFileName(scope: BackupScope, title?: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  if (scope.kind === 'notebook') {
    const safe = (title ?? 'notebook').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'notebook'
    return `${safe}-${stamp}.notivra`
  }
  return `notivra-backup-${stamp}.notivra`
}
