import { db } from '../../db/database'
import { enqueueSync, queueKey, tableFor } from '../../db/repository'
import type { ConflictRecord, EntityMap, PdfDocument, SyncEntity, SyncQueueEntry } from '../../db/types'
import { getFileStore, type FileStore } from '../storage/fileStore'
import { getSetting, setSetting } from '../settings'
import { SYNC_ORDER, TABLE_NAMES, fromRemote, sameContent, toRemote, type RemoteRow } from './mapping'
import { RemoteError, type SyncRemote } from './remote'

const PULL_PAGE = 500
/** Re-read this much history each run: commits can become visible slightly out of order. */
const PULL_OVERLAP_MS = 60_000
const BACKOFF_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000]

export interface SyncReport {
  pushed: number
  pulled: number
  conflicts: number
  failed: number
  filesUploaded: number
}

/**
 * Offline-first sync.
 *
 * Invariants
 * - Local data is the source of truth for local edits: a pulled row never overwrites a record
 *   that has unsynced local changes. Such cases become explicit conflicts for the user.
 * - Pushes carry the last server revision seen (`serverRev`); the server rejects stale writes.
 * - Every step is idempotent and safe to retry: a push whose response was lost is detected
 *   on retry (same content already on the server) and treated as success.
 */
export class SyncEngine {
  private readonly remote: SyncRemote
  private readonly ownerId: string
  private readonly files: FileStore

  constructor(remote: SyncRemote, ownerId: string, files: FileStore = getFileStore()) {
    this.remote = remote
    this.ownerId = ownerId
    this.files = files
  }

  async syncOnce(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, failed: 0, filesUploaded: 0 }
    await this.pushAll(report)
    await this.pullAll(report)
    await this.uploadFiles(report)
    // Records created by file uploads (remotePath) go out in the same run.
    if (report.filesUploaded > 0) await this.pushAll(report)
    await setSetting('lastSyncAt', Date.now())
    await setSetting('syncedAccountId', this.ownerId)
    return report
  }

  // ───────────── push ─────────────

  async pushAll(report: SyncReport): Promise<void> {
    const now = Date.now()
    const entries = (await db.syncQueue.toArray())
      .filter((e) => e.nextAttemptAt <= now)
      .sort((a, b) => SYNC_ORDER.indexOf(a.entity) - SYNC_ORDER.indexOf(b.entity) || a.enqueuedAt - b.enqueuedAt)
    for (const entry of entries) {
      try {
        await this.pushOne(entry, report)
      } catch (error) {
        report.failed++
        await this.scheduleRetry(entry, error)
        // Offline or signed out: no point trying the rest now.
        if (error instanceof RemoteError && (error.kind === 'network' || error.kind === 'auth')) throw error
      }
    }
  }

  private async pushOne(entry: SyncQueueEntry, report: SyncReport): Promise<void> {
    const { entity, entityId } = entry
    const table = tableFor(entity)
    const record = await table.get(entityId)
    if (!record) {
      await db.syncQueue.delete(entry.key)
      return
    }
    if (record.syncStatus === 'conflict') return // waits for the user's decision

    let result
    try {
      result = await this.remote.push(TABLE_NAMES[entity], entityId, record.serverRev, toRemote(entity, record))
    } catch (error) {
      if (error instanceof RemoteError && error.kind === 'duplicate' && (entity === 'xpEvents' || entity === 'userAchievements')) {
        // Another device already recorded this award under a different id. The cloud copy is
        // canonical; drop ours (the next pull brings theirs). This keeps XP from doubling.
        await db.transaction('rw', table, db.syncQueue, async () => {
          await table.delete(entityId)
          await db.syncQueue.delete(entry.key)
        })
        return
      }
      throw error
    }

    if (result.status === 'conflict') {
      if (sameContent(entity, record, result.remote)) {
        // Our earlier push succeeded but its response was lost: adopt the server revision.
        await this.markPushed(entry, record.rev, result.remote.rev)
        report.pushed++
        return
      }
      await this.markConflict(entity, record, result.remote)
      report.conflicts++
      return
    }
    await this.markPushed(entry, record.rev, result.rev)
    report.pushed++
  }

  private async markPushed(entry: SyncQueueEntry, pushedRev: number, serverRev: number): Promise<void> {
    const table = tableFor(entry.entity)
    await db.transaction('rw', table, db.syncQueue, async () => {
      const current = await table.get(entry.entityId)
      if (!current) return
      const unchanged = current.rev === pushedRev
      await table.update(entry.entityId, {
        serverRev,
        ownerId: this.ownerId,
        ...(unchanged && current.syncStatus !== 'conflict' ? { syncStatus: 'synced' as const } : {}),
      } as never)
      const queued = await db.syncQueue.get(entry.key)
      // A newer local edit re-enqueued the record: keep that entry for the next round.
      if (unchanged && queued && queued.enqueuedAt === entry.enqueuedAt) await db.syncQueue.delete(entry.key)
    })
  }

  private async scheduleRetry(entry: SyncQueueEntry, error: unknown): Promise<void> {
    const attempts = entry.attempts + 1
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!
    const current = await db.syncQueue.get(entry.key)
    if (!current || current.enqueuedAt !== entry.enqueuedAt) return // superseded by a newer edit
    await db.syncQueue.update(entry.key, {
      attempts,
      nextAttemptAt: Date.now() + delay,
      lastError: error instanceof Error ? error.message.slice(0, 300) : 'Sync failed',
    })
  }

  private async markConflict<E extends SyncEntity>(entity: E, local: EntityMap[E], remote: RemoteRow): Promise<void> {
    const table = tableFor(entity)
    const key = queueKey(entity, local.id)
    await db.transaction('rw', table, db.syncQueue, db.conflicts, async () => {
      await table.update(local.id, { syncStatus: 'conflict' } as never)
      const conflict: ConflictRecord = { key, entity, entityId: local.id, remote, remoteRev: remote.rev, detectedAt: Date.now() }
      await db.conflicts.put(conflict)
      await db.syncQueue.delete(key)
    })
  }

  // ───────────── pull ─────────────

  async pullAll(report: SyncReport): Promise<void> {
    const cursors = { ...(await getSetting('syncCursors')) }
    for (const entity of SYNC_ORDER) {
      const tableName = TABLE_NAMES[entity]
      const saved = cursors[tableName] ?? null
      let since = saved ? new Date(Date.parse(saved) - PULL_OVERLAP_MS).toISOString() : null
      let newest = saved
      for (;;) {
        const rows = await this.remote.pull(tableName, since, PULL_PAGE)
        for (const row of rows) {
          if (await this.applyRemote(entity, row)) report.pulled++
          if (!newest || row.server_updated_at > newest) newest = row.server_updated_at
        }
        if (rows.length < PULL_PAGE) break
        since = rows[rows.length - 1]!.server_updated_at // later pages: exact cursor, no overlap
      }
      if (newest && newest !== saved) {
        cursors[tableName] = newest
        await setSetting('syncCursors', cursors)
      }
    }
  }

  /** Applies one cloud row. Returns true if local data changed. */
  async applyRemote<E extends SyncEntity>(entity: E, row: RemoteRow): Promise<boolean> {
    const table = tableFor(entity)
    // File availability is checked outside the transaction (native file APIs aren't IndexedDB).
    let hasFile: boolean | null = null
    if (entity === 'documents') hasFile = await this.files.has(String(row.file_key))

    const changed = await db.transaction('rw', [table, db.syncQueue, db.conflicts], async () => {
      const local = await table.get(row.id)

      if (!local) {
        await this.removeUniqueDuplicate(entity, row)
        const record = fromRemote(entity, row)
        ;(record as { rev: number }).rev = 1
        if (entity === 'documents') this.applyFileStatus(record as PdfDocument, row, hasFile)
        await table.put(record)
        return true
      }

      if (local.serverRev !== null && row.rev <= local.serverRev) return false // already have it

      if (local.syncStatus === 'synced') {
        const record = fromRemote(entity, row, local)
        ;(record as { rev: number }).rev = local.rev + 1 // invalidates stale editors in other tabs
        if (entity === 'documents') this.applyFileStatus(record as PdfDocument, row, hasFile)
        await table.put(record)
        return true
      }

      // Unsynced local changes exist.
      if (sameContent(entity, local, row)) {
        await table.update(local.id, { serverRev: row.rev, syncStatus: 'synced' } as never)
        await db.syncQueue.delete(queueKey(entity, local.id))
        return false
      }
      const key = queueKey(entity, local.id)
      await table.update(local.id, { syncStatus: 'conflict' } as never)
      await db.conflicts.put({ key, entity, entityId: local.id, remote: row, remoteRev: row.rev, detectedAt: Date.now() })
      await db.syncQueue.delete(key)
      return false
    })

    // A document purged on another device: reclaim the local binary too.
    if (changed && entity === 'documents' && row.purged_at && hasFile) await this.files.remove(String(row.file_key))
    return changed
  }

  private applyFileStatus(doc: PdfDocument, row: RemoteRow, hasFile: boolean | null): void {
    if (hasFile) doc.fileSyncStatus = row.remote_path ? 'uploaded' : 'local'
    else doc.fileSyncStatus = row.remote_path ? 'remote-only' : 'missing'
  }

  /** XP events and achievements are unique by key; the cloud copy wins over a local duplicate. */
  private async removeUniqueDuplicate(entity: SyncEntity, row: RemoteRow): Promise<void> {
    if (entity === 'xpEvents') {
      const dup = await db.xpEvents.where('key').equals(String(row.key)).first()
      if (dup && dup.id !== row.id) {
        await db.xpEvents.delete(dup.id)
        await db.syncQueue.delete(queueKey('xpEvents', dup.id))
      }
    } else if (entity === 'userAchievements') {
      const dup = await db.userAchievements.where('achievementId').equals(String(row.achievement_id)).first()
      if (dup && dup.id !== row.id) {
        await db.userAchievements.delete(dup.id)
        await db.syncQueue.delete(queueKey('userAchievements', dup.id))
      }
    }
  }

  // ───────────── files ─────────────

  async uploadFiles(report: SyncReport): Promise<void> {
    const docs = (await db.documents.toArray()).filter((d) => d.fileSyncStatus === 'local' && d.purgedAt === null && d.deletedAt === null && d.serverRev !== null)
    for (const doc of docs) {
      const bytes = await this.files.get(doc.fileKey)
      if (!bytes) continue
      const path = `${this.ownerId}/${doc.fileKey}.pdf`
      try {
        await this.remote.uploadFile(path, bytes)
      } catch (error) {
        if (error instanceof RemoteError && error.kind === 'too_large') {
          await db.documents.update(doc.id, { fileSyncStatus: 'too-large' })
          continue
        }
        throw error
      }
      // remotePath is synced data (bump + enqueue); fileSyncStatus is device-local.
      await db.transaction('rw', db.documents, db.syncQueue, async () => {
        const current = await db.documents.get(doc.id)
        if (!current) return
        await db.documents.put({ ...current, remotePath: path, fileSyncStatus: 'uploaded', rev: current.rev + 1, syncStatus: current.syncStatus === 'conflict' ? 'conflict' : 'pending', updatedAt: Date.now() })
        await enqueueSync('documents', doc.id)
      })
      report.filesUploaded++
    }
  }

  /** Downloads a cloud-only PDF into the local file store. */
  async downloadFile(doc: Pick<PdfDocument, 'id' | 'fileKey' | 'remotePath'>): Promise<Uint8Array> {
    if (!doc.remotePath) throw new RemoteError('server', 'This PDF has not been uploaded to the cloud.')
    const bytes = await this.remote.downloadFile(doc.remotePath)
    await this.files.put(doc.fileKey, bytes)
    await db.documents.update(doc.id, { fileSyncStatus: 'uploaded' })
    return bytes
  }

  // ───────────── conflicts ─────────────

  /** Keep this device's version: it will overwrite the cloud copy on the next push. */
  static async keepLocal(conflictKey: string): Promise<void> {
    const conflict = await db.conflicts.get(conflictKey)
    if (!conflict) return
    const table = tableFor(conflict.entity)
    await db.transaction('rw', table, db.syncQueue, db.conflicts, async () => {
      const local = await table.get(conflict.entityId)
      if (local) {
        await table.update(conflict.entityId, { serverRev: conflict.remoteRev, syncStatus: 'pending' } as never)
        await enqueueSync(conflict.entity, conflict.entityId)
      }
      await db.conflicts.delete(conflictKey)
    })
  }

  /** Use the cloud version: replaces the local record (the local version is discarded). */
  static async takeRemote(conflictKey: string): Promise<void> {
    const conflict = await db.conflicts.get(conflictKey)
    if (!conflict) return
    const table = tableFor(conflict.entity)
    await db.transaction('rw', table, db.syncQueue, db.conflicts, async () => {
      const local = await table.get(conflict.entityId)
      const record = fromRemote(conflict.entity, conflict.remote as RemoteRow, local)
      ;(record as { rev: number }).rev = (local?.rev ?? 0) + 1
      await table.put(record)
      await db.syncQueue.delete(conflictKey)
      await db.conflicts.delete(conflictKey)
    })
  }
}
