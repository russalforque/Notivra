import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { AppError } from '../../lib/errors'

// The legacy build supports older Android System WebViews that lack recent JS features.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy, PageViewport, RenderTask } from 'pdfjs-dist'

/** Opens a PDF from bytes. A copy is passed because pdf.js transfers (detaches) the buffer. */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    return await pdfjs.getDocument({
      data: bytes.slice(),
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
      iccUrl: '/pdfjs/iccs/',
      enableXfa: false,
    }).promise
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === 'PasswordException') throw new AppError('This PDF is password-protected. Remove the password in another app, then import it again.', { cause: error })
    if (name === 'InvalidPDFException') throw new AppError('This file is not a valid PDF or is damaged.', { cause: error })
    throw new AppError('This PDF could not be opened.', { cause: error })
  }
}

/** Releases the worker-side document and all page resources. */
export function closePdf(doc: PDFDocumentProxy): Promise<void> {
  return doc.loadingTask.destroy()
}

export interface PdfInfo {
  pageCount: number
  thumbnail: string | null
  title: string | null
}

/** Reads page count, metadata title and a small first-page thumbnail. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const doc = await openPdf(bytes)
  try {
    let title: string | null = null
    try {
      const meta = await doc.getMetadata()
      const t = (meta.info as { Title?: unknown } | undefined)?.Title
      if (typeof t === 'string' && t.trim()) title = t.trim().slice(0, 120)
    } catch {
      // metadata is optional
    }
    let thumbnail: string | null = null
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 240 / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      thumbnail = canvas.toDataURL('image/jpeg', 0.72)
      page.cleanup()
    } catch {
      // A thumbnail is cosmetic; import still succeeds without it.
    }
    return { pageCount: doc.numPages, thumbnail, title }
  } finally {
    await closePdf(doc)
  }
}

/** Extracts plain text from a page range (1-based, inclusive). Used for AI study tools. */
export async function extractText(bytes: Uint8Array, from = 1, to = Infinity, maxChars = 120_000): Promise<{ text: string; pages: number }> {
  const doc = await openPdf(bytes)
  try {
    const last = Math.min(doc.numPages, to)
    let text = ''
    let pages = 0
    for (let i = Math.max(1, from); i <= last && text.length < maxChars; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('')
      text += `\n\n[Page ${i}]\n${pageText.replace(/[ \t]+/g, ' ').trim()}`
      pages++
      page.cleanup()
    }
    return { text: text.slice(0, maxChars).trim(), pages }
  } finally {
    await closePdf(doc)
  }
}
