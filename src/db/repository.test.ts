import { describe, expect, it } from 'vitest'
import { db } from './database'
import { createRecord, restoreRecord, softDelete, updateRecord } from './repository'
import { ConflictError, RecordNotFoundError } from '../lib/errors'

const subject = { name: 'Biology', color: '#10b981', sortOrder: 0 }

describe('repository', () => {
  it('creates records with sync metadata and enqueues them atomically', async () => {
    const s = await createRecord('subjects', subject)
    expect(s.rev).toBe(1)
    expect(s.syncStatus).toBe('pending')
    expect(s.deletedAt).toBeNull()
    expect(await db.subjects.get(s.id)).toEqual(s)
    expect(await db.syncQueue.get(`subjects:${s.id}`)).toMatchObject({ entity: 'subjects', entityId: s.id })
  })

  it('increments revision on update and coalesces the queue entry', async () => {
    const s = await createRecord('subjects', subject)
    const u1 = await updateRecord('subjects', s.id, { name: 'Bio 101' })
    const u2 = await updateRecord('subjects', s.id, { name: 'Bio 102' })
    expect(u1.rev).toBe(2)
    expect(u2.rev).toBe(3)
    expect(u2.createdAt).toBe(s.createdAt)
    expect(await db.syncQueue.count()).toBe(1)
  })

  it('rejects writes with a stale expected revision without changing data', async () => {
    const s = await createRecord('subjects', subject)
    await updateRecord('subjects', s.id, { name: 'Changed in another tab' })
    await expect(updateRecord('subjects', s.id, { name: 'Stale' }, { expectedRev: 1 })).rejects.toBeInstanceOf(ConflictError)
    expect((await db.subjects.get(s.id))?.name).toBe('Changed in another tab')
  })

  it('soft deletes with a tombstone and can restore', async () => {
    const s = await createRecord('subjects', subject)
    await softDelete('subjects', s.id)
    const deleted = await db.subjects.get(s.id)
    expect(deleted?.deletedAt).not.toBeNull()
    await expect(updateRecord('subjects', s.id, { name: 'x' })).rejects.toBeInstanceOf(RecordNotFoundError)
    await restoreRecord('subjects', s.id)
    expect((await db.subjects.get(s.id))?.deletedAt).toBeNull()
  })

  it('keeps a conflict status visible across subsequent local edits', async () => {
    const s = await createRecord('subjects', subject)
    await db.subjects.update(s.id, { syncStatus: 'conflict' })
    const u = await updateRecord('subjects', s.id, { name: 'Edited' })
    expect(u.syncStatus).toBe('conflict')
  })
})
