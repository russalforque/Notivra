import type { Table } from 'dexie'
import { db } from './database'
import { getOwnerId } from './session'
import type { EntityMap, SyncedRecord, SyncEntity, SyncMetaKey, SyncQueueEntry } from './types'
import { ConflictError, RecordNotFoundError, guardStorage } from '../lib/errors'
import { newId } from '../lib/ids'
import { now } from '../lib/time'

/**
 * Generic, entity-agnostic write path. All mutations of synchronizable records go through
 * here so that every local change is (1) persisted, (2) revisioned and (3) enqueued for
 * sync in ONE IndexedDB transaction — a crash can never leave a change un-enqueued.
 */

export type NewRecord<E extends SyncEntity> = Omit<EntityMap[E], SyncMetaKey> & { id?: string }
export type RecordPatch<E extends SyncEntity> = Partial<Omit<EntityMap[E], SyncMetaKey>>

export function tableFor<E extends SyncEntity>(entity: E): Table<EntityMap[E], string> {
  return db.table(entity) as Table<EntityMap[E], string>
}

export function queueKey(entity: SyncEntity, id: string): string {
  return `${entity}:${id}`
}

/** Must be called inside a transaction that includes `db.syncQueue`. */
export async function enqueueSync(entity: SyncEntity, entityId: string): Promise<void> {
  const entry: SyncQueueEntry = {
    key: queueKey(entity, entityId),
    entity,
    entityId,
    enqueuedAt: now(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  }
  await db.syncQueue.put(entry)
}

export function stampNew<E extends SyncEntity>(data: NewRecord<E>, at = now()): EntityMap[E] {
  const meta: SyncedRecord = {
    id: data.id ?? newId(),
    ownerId: getOwnerId(),
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    rev: 1,
    serverRev: null,
    syncStatus: 'pending',
  }
  return { ...data, ...meta } as EntityMap[E]
}

/** Produces the next local revision of a record. Identity and creation metadata are preserved. */
export function bump<T extends SyncedRecord>(record: T, patch: Partial<T>, at = now()): T {
  return {
    ...record,
    ...patch,
    id: record.id,
    createdAt: record.createdAt,
    ownerId: record.ownerId ?? getOwnerId(),
    updatedAt: at,
    rev: record.rev + 1,
    // An unresolved conflict stays visible until the user resolves it.
    syncStatus: record.syncStatus === 'conflict' ? 'conflict' : 'pending',
  }
}

export async function createRecord<E extends SyncEntity>(entity: E, data: NewRecord<E>): Promise<EntityMap[E]> {
  const [record] = await createMany(entity, [stampNew<E>(data)])
  return record!
}

export async function createMany<E extends SyncEntity>(entity: E, records: EntityMap[E][]): Promise<EntityMap[E][]> {
  const table = tableFor(entity)
  await guardStorage(() =>
    db.transaction('rw', table, db.syncQueue, async () => {
      await table.bulkAdd(records)
      for (const r of records) await enqueueSync(entity, r.id)
    }),
  )
  return records
}

export interface UpdateOptions {
  /** Reject the write if the stored revision differs (optimistic concurrency between tabs). */
  expectedRev?: number
  /** Allow updating a soft-deleted record (used by restore and purge). */
  includeDeleted?: boolean
}

async function updateInternal<E extends SyncEntity>(
  entity: E,
  id: string,
  patch: Partial<EntityMap[E]> | ((current: EntityMap[E]) => Partial<EntityMap[E]>),
  options: UpdateOptions,
): Promise<EntityMap[E]> {
  const table = tableFor(entity)
  return guardStorage(() =>
    db.transaction('rw', table, db.syncQueue, async () => {
      const current = await table.get(id)
      if (!current || (current.deletedAt !== null && !options.includeDeleted)) throw new RecordNotFoundError()
      if (options.expectedRev !== undefined && current.rev !== options.expectedRev) {
        throw new ConflictError()
      }
      const resolved = typeof patch === 'function' ? patch(current) : patch
      const next = bump(current, resolved)
      await table.put(next)
      await enqueueSync(entity, id)
      return next
    }),
  )
}

export function updateRecord<E extends SyncEntity>(
  entity: E,
  id: string,
  patch: RecordPatch<E> | ((current: EntityMap[E]) => RecordPatch<E>),
  options: UpdateOptions = {},
): Promise<EntityMap[E]> {
  return updateInternal(entity, id, patch as Partial<EntityMap[E]>, options)
}

export async function softDelete(entity: SyncEntity, id: string): Promise<void> {
  await updateInternal(entity, id, { deletedAt: now() }, {})
}

export async function restoreRecord(entity: SyncEntity, id: string): Promise<void> {
  await updateInternal(entity, id, { deletedAt: null }, { includeDeleted: true })
}

/** Tombstones many records of one entity in one transaction (e.g. the pages of a notebook). */
export async function softDeleteMany<E extends SyncEntity>(
  entity: E,
  ids: string[],
  extraPatch: Partial<EntityMap[E]> = {},
): Promise<void> {
  if (ids.length === 0) return
  const table = tableFor(entity)
  const at = now()
  await guardStorage(() =>
    db.transaction('rw', table, db.syncQueue, async () => {
      const rows = await table.bulkGet(ids)
      const next = rows
        .filter((r): r is EntityMap[E] => !!r)
        .map((r) => bump(r, { ...extraPatch, deletedAt: r.deletedAt ?? at }, at))
      await table.bulkPut(next)
      for (const r of next) await enqueueSync(entity, r.id)
    }),
  )
}

/** Generic patch that may also set tombstone fields; used by purge flows. */
export function updateIncludingDeleted<E extends SyncEntity>(
  entity: E,
  id: string,
  patch: Partial<EntityMap[E]>,
): Promise<EntityMap[E]> {
  return updateInternal(entity, id, patch, { includeDeleted: true })
}

export function isLive<T extends SyncedRecord>(record: T | undefined | null): record is T {
  return !!record && record.deletedAt === null
}
