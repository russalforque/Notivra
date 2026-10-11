import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { db } from '../../db/database'
import { createNotebook } from '../../features/library/libraryService'
import { listPages, savePageContent } from '../../features/notebook/pageService'
import { createRecord } from '../../db/repository'
import { ValidationError } from '../../lib/errors'
import { getFileStore } from '../storage/fileStore'
import { createBackup, parseBackup, restoreBackup } from './backupService'

async function seed() {
  const nb = await createNotebook({ title: 'Biology' })
  const [page] = await listPages(nb.id)
  await savePageContent(
    page!.id,
    {
      strokes: [{ id: 's1', tool: 'pen', color: '#111111', size: 3, points: [10, 10, 0.5, 20, 20, 0.6] }],
      textBlocks: [{ id: 't1', x: 5, y: 5, width: 200, text: 'Mitochondria', fontSize: 18, color: '#111111' }],
    },
    page!.rev,
  )
  const pdfBytes = strToU8('%PDF-1.4 fake pdf for test')
  await getFileStore().put('file-1', pdfBytes)
  await createRecord('documents', {
    title: 'Lecture',
    subjectId: null,
    folderId: null,
    fileName: 'lecture.pdf',
    byteSize: pdfBytes.byteLength,
    pageCount: 1,
    fileKey: 'file-1',
    sha256: 'x',
    thumbnail: null,
    remotePath: null,
    fileSyncStatus: 'local',
    lastPage: 0,
    lastScale: 1,
    rotation: 0,
    lastOpenedAt: null,
    purgedAt: null,
  })
  return { nb, pageId: page!.id }
}

async function wipe() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

describe('backup and restore', () => {
  it('round-trips notebooks, pages and PDF binaries', async () => {
    const { nb, pageId } = await seed()
    const { bytes, manifest } = await createBackup()
    expect(manifest.counts.notebooks).toBe(1)
    expect(manifest.files).toHaveLength(1)

    await wipe()
    const report = await restoreBackup(await parseBackup(bytes))
    expect(report.added).toBeGreaterThanOrEqual(3)
    expect(report.files).toBe(1)
    expect((await db.notebooks.get(nb.id))?.title).toBe('Biology')
    const page = await db.pages.get(pageId)
    expect(page?.strokes[0]?.points).toEqual([10, 10, 0.5, 20, 20, 0.6])
    expect(page?.plainText).toBe('Mitochondria')
    expect(new TextDecoder().decode((await getFileStore().get('file-1'))!)).toContain('%PDF')
    // Restored data is queued for sync like any local change.
    expect(await db.syncQueue.get(`notebooks:${nb.id}`)).toBeDefined()
  })

  it('never overwrites newer local edits with older backup data', async () => {
    const { pageId } = await seed()
    const { bytes } = await createBackup()
    const page = await db.pages.get(pageId)
    await savePageContent(pageId, { strokes: [], textBlocks: [{ id: 't2', x: 0, y: 0, width: 10, text: 'Newer', fontSize: 12, color: '#000000' }] }, page!.rev)

    const report = await restoreBackup(await parseBackup(bytes))
    expect(report.updated).toBe(0)
    expect((await db.pages.get(pageId))?.plainText).toBe('Newer')
  })

  it('rejects files that are not backups', async () => {
    await expect(parseBackup(strToU8('hello'))).rejects.toBeInstanceOf(ValidationError)
    const noManifest = zipSync({ 'data.json': strToU8('{}') })
    await expect(parseBackup(noManifest)).rejects.toThrow(/not a Notivra backup/)
  })

  it('rejects damaged records without writing anything', async () => {
    await seed()
    const { bytes } = await createBackup()
    const { unzipSync, strFromU8 } = await import('fflate')
    const entries = unzipSync(bytes)
    const data = JSON.parse(strFromU8(entries['data.json']!))
    data.pages[0].strokes[0].points = [1, 2] // not triples
    entries['data.json'] = strToU8(JSON.stringify(data))
    await wipe()
    await expect(parseBackup(zipSync(entries))).rejects.toThrow(/damaged/)
    expect(await db.pages.count()).toBe(0)
  })

  it('detects corrupted PDF binaries', async () => {
    await seed()
    const { bytes } = await createBackup()
    const { unzipSync } = await import('fflate')
    const entries = unzipSync(bytes)
    entries['files/file-1'] = strToU8('tampered')
    await expect(parseBackup(zipSync(entries))).rejects.toThrow(/integrity/)
  })
})
