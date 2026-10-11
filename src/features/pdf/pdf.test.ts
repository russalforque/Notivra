import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { db } from '../../db/database'
import { sha256Hex } from '../../lib/base64'
import { ValidationError } from '../../lib/errors'
import { getFileStore } from '../../services/storage/fileStore'
import { buildAnnotation, listAnnotations, persistAdd, persistRemove, persistUpdate } from './annotationService'
import { importPdf, loadDocumentBytes, looksLikePdf } from './documentService'
import { exportAnnotatedPdf } from './pdfExport'

async function makePdf(pages = 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < pages; i++) pdf.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 24 })
  return pdf.save()
}

const fakeInspect = async () => ({ pageCount: 2, thumbnail: null, title: null })

describe('PDF import', () => {
  it('stores the original binary and metadata', async () => {
    const bytes = await makePdf()
    const { document, duplicate } = await importPdf('Lecture 1.pdf', bytes, fakeInspect)
    expect(duplicate).toBe(false)
    expect(document.title).toBe('Lecture 1')
    expect(document.pageCount).toBe(2)
    expect(document.sha256).toBe(await sha256Hex(bytes))
    expect(await loadDocumentBytes(document)).toEqual(bytes)
  })

  it('rejects non-PDF and empty files', async () => {
    await expect(importPdf('notes.pdf', new TextEncoder().encode('hello'), fakeInspect)).rejects.toBeInstanceOf(ValidationError)
    await expect(importPdf('empty.pdf', new Uint8Array(), fakeInspect)).rejects.toBeInstanceOf(ValidationError)
    expect(looksLikePdf(new TextEncoder().encode('junk\n%PDF-1.7'))).toBe(true)
  })

  it('detects duplicates instead of storing the same file twice', async () => {
    const bytes = await makePdf()
    const first = await importPdf('a.pdf', bytes, fakeInspect)
    const second = await importPdf('b.pdf', bytes, fakeInspect)
    expect(second.duplicate).toBe(true)
    expect(second.document.id).toBe(first.document.id)
    expect(await db.files.count()).toBe(1)
  })

  it('removes the stored binary if inspection fails', async () => {
    const bytes = await makePdf()
    await expect(
      importPdf('broken.pdf', bytes, async () => {
        throw new ValidationError('broken')
      }),
    ).rejects.toThrow('broken')
    expect(await db.files.count()).toBe(0)
    expect(await db.documents.count()).toBe(0)
  })
})

describe('annotations', () => {
  it('persists idempotently: retrying add/remove is safe', async () => {
    const a = buildAnnotation({ documentId: 'd1', pageIndex: 0, color: '#ff0000', opacity: 1, shape: { kind: 'rect', rect: [10, 10, 50, 50], width: 2 } })
    await persistAdd(a)
    await persistAdd(a)
    expect(await listAnnotations('d1')).toHaveLength(1)
    await persistUpdate(a.id, { color: '#00ff00' })
    expect((await listAnnotations('d1'))[0]?.color).toBe('#00ff00')
    await persistRemove(a.id)
    await persistRemove(a.id)
    expect(await listAnnotations('d1')).toHaveLength(0)
    await persistAdd(a) // undo of a delete restores the tombstone
    expect(await listAnnotations('d1')).toHaveLength(1)
  })

  it('keeps stored coordinates exactly (zoom-independent user space)', async () => {
    const a = buildAnnotation({ documentId: 'd2', pageIndex: 1, color: '#000000', opacity: 1, shape: { kind: 'ink', points: [100.25, 200.5, 110, 210], width: 1.5 } })
    await persistAdd(a)
    const [stored] = await listAnnotations('d2')
    expect(stored?.shape).toEqual({ kind: 'ink', points: [100.25, 200.5, 110, 210], width: 1.5 })
  })
})

describe('annotated PDF export', () => {
  it('produces a valid new PDF and never modifies the original', async () => {
    const original = await makePdf(2)
    const before = await sha256Hex(original)
    const anns = [
      buildAnnotation({ documentId: 'd', pageIndex: 0, color: '#2563eb', opacity: 1, shape: { kind: 'ink', points: [72, 600, 150, 650, 220, 610], width: 2 } }),
      buildAnnotation({ documentId: 'd', pageIndex: 0, color: '#facc15', opacity: 0.35, shape: { kind: 'highlight', rect: [70, 695, 200, 725] } }),
      buildAnnotation({ documentId: 'd', pageIndex: 1, color: '#dc2626', opacity: 1, shape: { kind: 'text', x: 72, y: 500, text: 'Remember this — “key” idea ✓ 日本', fontSize: 14 } }),
      buildAnnotation({ documentId: 'd', pageIndex: 1, color: '#16a34a', opacity: 1, shape: { kind: 'ellipse', rect: [100, 100, 200, 160], width: 2 } }),
      buildAnnotation({ documentId: 'd', pageIndex: 1, color: '#000000', opacity: 1, shape: { kind: 'arrow', from: [300, 300], to: [400, 350], width: 2 } }),
      buildAnnotation({ documentId: 'd', pageIndex: 9, color: '#000000', opacity: 1, shape: { kind: 'rect', rect: [0, 0, 1, 1], width: 1 } }),
    ]
    const out = await exportAnnotatedPdf(original, anns, 'Annotated')
    expect(await sha256Hex(original)).toBe(before)
    expect(new TextDecoder().decode(out.subarray(0, 5))).toBe('%PDF-')
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(2)
    expect(reloaded.getTitle()).toBe('Annotated')
    expect(out.byteLength).toBeGreaterThan(original.byteLength)
  })

  it('works end-to-end from the file store', async () => {
    const bytes = await makePdf(1)
    const { document } = await importPdf('x.pdf', bytes, async () => ({ pageCount: 1, thumbnail: null, title: null }))
    await persistAdd(buildAnnotation({ documentId: document.id, pageIndex: 0, color: '#000000', opacity: 1, shape: { kind: 'line', from: [0, 0], to: [100, 100], width: 1 } }))
    const out = await exportAnnotatedPdf(await loadDocumentBytes(document), await listAnnotations(document.id))
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
    expect(await getFileStore().get(document.fileKey)).toEqual(bytes)
  })
})
