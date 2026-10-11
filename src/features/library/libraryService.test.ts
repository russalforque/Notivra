import { describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { ValidationError } from '../../lib/errors'
import { DAY_MS } from '../../lib/time'
import { addPage, listPages, savePageContent } from '../notebook/pageService'
import {
  createNotebook,
  createSubject,
  deleteSubject,
  purgeExpiredTrash,
  purgeNotebook,
  restoreNotebook,
  trashNotebook,
} from './libraryService'

describe('library service', () => {
  it('creates a notebook with a first page in one step', async () => {
    const nb = await createNotebook({ title: '  Chemistry notes  ' })
    expect(nb.title).toBe('Chemistry notes')
    const pages = await listPages(nb.id)
    expect(pages).toHaveLength(1)
    expect(pages[0]?.template).toBe('lined')
  })

  it('validates titles', async () => {
    await expect(createNotebook({ title: '   ' })).rejects.toBeInstanceOf(ValidationError)
    await expect(createNotebook({ title: 'x'.repeat(121) })).rejects.toBeInstanceOf(ValidationError)
  })

  it('orders inserted pages with fractional sort keys', async () => {
    const nb = await createNotebook({ title: 'Physics' })
    const [first] = await listPages(nb.id)
    const third = await addPage(nb.id, first!.id, 'grid')
    const second = await addPage(nb.id, first!.id, 'dotted')
    expect((await listPages(nb.id)).map((p) => p.id)).toEqual([first!.id, second.id, third.id])
  })

  it('trash keeps content and restore brings the notebook back', async () => {
    const nb = await createNotebook({ title: 'History' })
    const [page] = await listPages(nb.id)
    await savePageContent(page!.id, { strokes: [], textBlocks: [{ id: 't', x: 1, y: 1, width: 100, text: 'WW2', fontSize: 16, color: '#000000' }] }, page!.rev)
    await trashNotebook(nb.id)
    expect((await db.notebooks.get(nb.id))?.deletedAt).not.toBeNull()
    await restoreNotebook(nb.id)
    expect((await db.notebooks.get(nb.id))?.deletedAt).toBeNull()
    expect((await listPages(nb.id))[0]?.plainText).toBe('WW2')
  })

  it('purge strips content but keeps tombstones for sync', async () => {
    const nb = await createNotebook({ title: 'Secret diary' })
    const [page] = await listPages(nb.id)
    await savePageContent(page!.id, { strokes: [{ id: 's', tool: 'pen', color: '#000000', size: 2, points: [1, 1, 0.5] }], textBlocks: [] }, page!.rev)
    await trashNotebook(nb.id)
    await purgeNotebook(nb.id)
    const tomb = await db.notebooks.get(nb.id)
    expect(tomb?.purgedAt).not.toBeNull()
    expect(tomb?.title).not.toContain('Secret')
    const storedPage = await db.pages.get(page!.id)
    expect(storedPage?.strokes).toEqual([])
    expect(storedPage?.deletedAt).not.toBeNull()
    expect(await db.syncQueue.get(`pages:${page!.id}`)).toBeDefined()
  })

  it('only auto-purges trash older than the retention period', async () => {
    const recent = await createNotebook({ title: 'Recent' })
    const old = await createNotebook({ title: 'Old' })
    await trashNotebook(recent.id)
    await trashNotebook(old.id)
    await db.notebooks.update(old.id, { deletedAt: Date.now() - 31 * DAY_MS })
    expect(await purgeExpiredTrash()).toBe(1)
    expect((await db.notebooks.get(old.id))?.purgedAt).not.toBeNull()
    expect((await db.notebooks.get(recent.id))?.purgedAt).toBeNull()
  })

  it('deleting a subject keeps its notebooks', async () => {
    const s = await createSubject('Math')
    const nb = await createNotebook({ title: 'Algebra', subjectId: s.id })
    await deleteSubject(s.id)
    const kept = await db.notebooks.get(nb.id)
    expect(kept?.deletedAt).toBeNull()
    expect(kept?.subjectId).toBeNull()
  })
})
