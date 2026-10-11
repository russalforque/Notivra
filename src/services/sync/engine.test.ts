import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { setOwnerId } from '../../db/session'
import { createNotebook, createSubject, trashNotebook } from '../../features/library/libraryService'
import { listPages, savePageContent } from '../../features/notebook/pageService'
import { awardXp } from '../../features/progress/xpService'
import { SyncEngine } from './engine'
import { InMemoryRemote } from './testRemote'

describe('sync engine', () => {
  let remote: InMemoryRemote
  let engine: SyncEngine

  beforeEach(() => {
    setOwnerId('user-1')
    remote = new InMemoryRemote('user-1')
    engine = new SyncEngine(remote, 'user-1')
  })

  it('uploads local records and marks them synced', async () => {
    const nb = await createNotebook({ title: 'Biology' })
    await engine.syncOnce()
    expect(remote.tables.get('notebooks')?.get(nb.id)?.title).toBe('Biology')
    const local = await db.notebooks.get(nb.id)
    expect(local).toMatchObject({ syncStatus: 'synced', serverRev: 1, ownerId: 'user-1' })
    expect(await db.syncQueue.count()).toBe(0)
  })

  it('pulls changes made on another device when there are no local edits', async () => {
    const s = await createSubject('Math')
    await engine.syncOnce()
    remote.otherDeviceEdit('subjects', s.id, { name: 'Mathematics' })
    await engine.syncOnce()
    const local = await db.subjects.get(s.id)
    expect(local?.name).toBe('Mathematics')
    expect(local?.serverRev).toBe(2)
    expect(local?.rev).toBeGreaterThan(s.rev) // bumps local rev so stale editors detect it
  })

  it('never overwrites unsynced local edits; it records a conflict instead', async () => {
    const nb = await createNotebook({ title: 'History' })
    const [page] = await listPages(nb.id)
    await engine.syncOnce()

    // Concurrent edits: other device changes the page, this device too (offline).
    remote.otherDeviceEdit('pages', page!.id, { plain_text: 'theirs', text_blocks: [] })
    const fresh = await db.pages.get(page!.id)
    await savePageContent(page!.id, { strokes: [], textBlocks: [{ id: 't', x: 0, y: 0, width: 10, text: 'mine', fontSize: 12, color: '#000000' }] }, fresh!.rev)

    const r = await engine.syncOnce()
    expect(r.conflicts).toBe(1)
    const local = await db.pages.get(page!.id)
    expect(local?.plainText).toBe('mine')
    expect(local?.syncStatus).toBe('conflict')
    expect(await db.conflicts.count()).toBe(1)
    expect(remote.tables.get('pages')?.get(page!.id)?.plain_text).toBe('theirs')
  })

  it('resolves conflicts by keeping the local version', async () => {
    const s = await createSubject('Chem')
    await engine.syncOnce()
    remote.otherDeviceEdit('subjects', s.id, { name: 'Chemistry (remote)' })
    await db.subjects.update(s.id, { name: 'Chemistry (local)', syncStatus: 'pending', rev: 5 })
    await db.syncQueue.put({ key: `subjects:${s.id}`, entity: 'subjects', entityId: s.id, enqueuedAt: Date.now(), attempts: 0, nextAttemptAt: 0, lastError: null })
    await engine.syncOnce()
    const [conflict] = await db.conflicts.toArray()
    await SyncEngine.keepLocal(conflict!.key)
    await engine.syncOnce()
    expect(remote.tables.get('subjects')?.get(s.id)?.name).toBe('Chemistry (local)')
    expect((await db.subjects.get(s.id))?.syncStatus).toBe('synced')
    expect(await db.conflicts.count()).toBe(0)
  })

  it('resolves conflicts by taking the cloud version', async () => {
    const s = await createSubject('Art')
    await engine.syncOnce()
    remote.otherDeviceEdit('subjects', s.id, { name: 'Art (remote)' })
    await db.subjects.update(s.id, { name: 'Art (local)', syncStatus: 'pending' })
    await db.syncQueue.put({ key: `subjects:${s.id}`, entity: 'subjects', entityId: s.id, enqueuedAt: Date.now(), attempts: 0, nextAttemptAt: 0, lastError: null })
    await engine.syncOnce()
    const [conflict] = await db.conflicts.toArray()
    await SyncEngine.takeRemote(conflict!.key)
    const local = await db.subjects.get(s.id)
    expect(local).toMatchObject({ name: 'Art (remote)', syncStatus: 'synced', serverRev: 2 })
    expect(await db.syncQueue.count()).toBe(0)
  })

  it('treats a retried push whose response was lost as success (idempotent)', async () => {
    const s = await createSubject('Physics')
    remote.loseNextResponse = true
    await expect(engine.syncOnce()).rejects.toThrow(/lost/)
    expect((await db.subjects.get(s.id))?.syncStatus).toBe('pending')
    // Retry: server already has rev 1 with identical content.
    await db.syncQueue.toCollection().modify({ nextAttemptAt: 0 })
    const r = await engine.syncOnce()
    expect(r.conflicts).toBe(0)
    expect((await db.subjects.get(s.id))?.syncStatus).toBe('synced')
  })

  it('propagates deletions as tombstones', async () => {
    const nb = await createNotebook({ title: 'To delete' })
    await engine.syncOnce()
    await trashNotebook(nb.id)
    await engine.syncOnce()
    expect(remote.tables.get('notebooks')?.get(nb.id)?.deleted_at).not.toBeNull()
  })

  it('ignores stale cloud rows older than what this device already has', async () => {
    const s = await createSubject('Bio')
    await engine.syncOnce()
    const applied = await engine.applyRemote('subjects', { ...remote.tables.get('subjects')!.get(s.id)!, name: 'stale', rev: 1 })
    expect(applied).toBe(false)
    expect((await db.subjects.get(s.id))?.name).toBe('Bio')
  })

  it('does not double-count XP awarded for the same action on two devices', async () => {
    await awardXp({ key: 'daily:2026-01-01', type: 'daily_goal', amount: 15 })
    remote.otherDeviceInsert('xp_events', {
      id: 'other-device-event',
      key: 'daily:2026-01-01',
      type: 'daily_goal',
      amount: 15,
      subject_id: null,
      day_key: '2026-01-01',
      occurred_at: 1,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    })
    await engine.syncOnce()
    const events = await db.xpEvents.toArray()
    expect(events).toHaveLength(1)
    expect(events[0]?.id).toBe('other-device-event')
  })

  it('keeps working offline and retries later with backoff', async () => {
    await createSubject('Geo')
    remote.offline = true
    await expect(engine.syncOnce()).rejects.toThrow()
    const [entry] = await db.syncQueue.toArray()
    expect(entry?.attempts).toBe(1)
    expect(entry?.nextAttemptAt).toBeGreaterThan(Date.now())
    expect(entry?.lastError).toMatch(/fetch/i)
  })

  it('downloads records created on another device, including PDF files', async () => {
    remote.otherDeviceInsert('documents', {
      id: 'doc-remote',
      title: 'Remote PDF',
      subject_id: null,
      folder_id: null,
      file_name: 'r.pdf',
      byte_size: 4,
      page_count: 1,
      file_key: 'file-remote',
      sha256: 'x',
      thumbnail: null,
      remote_path: 'user-1/file-remote.pdf',
      purged_at: null,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    })
    remote.files.set('user-1/file-remote.pdf', new TextEncoder().encode('%PDF'))
    await engine.syncOnce()
    const doc = await db.documents.get('doc-remote')
    expect(doc?.fileSyncStatus).toBe('remote-only')
    await engine.downloadFile(doc!)
    expect((await db.documents.get('doc-remote'))?.fileSyncStatus).toBe('uploaded')
  })

  it('uploads PDF binaries to the private per-user path', async () => {
    await getFileStoreAndPut('file-local', '%PDF-1.4')
    await db.documents.put({
      id: 'doc-local',
      ownerId: 'user-1',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      rev: 1,
      serverRev: null,
      syncStatus: 'pending',
      title: 'Local PDF',
      subjectId: null,
      folderId: null,
      fileName: 'l.pdf',
      byteSize: 8,
      pageCount: 1,
      fileKey: 'file-local',
      sha256: 'x',
      thumbnail: null,
      remotePath: null,
      fileSyncStatus: 'local',
      lastPage: 0,
      lastScale: 0,
      rotation: 0,
      lastOpenedAt: null,
      purgedAt: null,
    })
    await db.syncQueue.put({ key: 'documents:doc-local', entity: 'documents', entityId: 'doc-local', enqueuedAt: 1, attempts: 0, nextAttemptAt: 0, lastError: null })
    const r = await engine.syncOnce()
    expect(r.filesUploaded).toBe(1)
    expect(remote.files.has('user-1/file-local.pdf')).toBe(true)
    expect(remote.tables.get('documents')?.get('doc-local')?.remote_path).toBe('user-1/file-local.pdf')
  })
})

async function getFileStoreAndPut(key: string, text: string) {
  const { getFileStore } = await import('../storage/fileStore')
  await getFileStore().put(key, new TextEncoder().encode(text))
}
