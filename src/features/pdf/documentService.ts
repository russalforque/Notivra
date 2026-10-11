import { db } from '../../db/database'
import { createRecord, updateRecord } from '../../db/repository'
import type { PdfDocument } from '../../db/types'
import { sha256Hex } from '../../lib/base64'
import { AppError, ValidationError } from '../../lib/errors'
import { newId } from '../../lib/ids'
import { parseOrThrow, titleSchema } from '../../lib/validation'
import { getFileStore } from '../../services/storage/fileStore'
import { ensureSpaceFor } from '../../services/storage/quota'
import type { PdfInfo } from './pdfjs'

export const MAX_PDF_BYTES = 300 * 1024 * 1024

export function looksLikePdf(bytes: Uint8Array): boolean {
  // The header may be preceded by junk bytes; the spec tolerates it within the first 1 KB.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}

export interface ImportResult {
  document: PdfDocument
  duplicate: boolean
}

/**
 * Imports a PDF: validates it, stores the original bytes in the platform file store, then
 * creates the metadata record. The original is never modified afterwards.
 */
export async function importPdf(
  name: string,
  bytes: Uint8Array,
  inspect: (bytes: Uint8Array) => Promise<PdfInfo>,
  options: { subjectId?: string | null } = {},
): Promise<ImportResult> {
  if (bytes.byteLength === 0) throw new ValidationError(`“${name}” is empty.`)
  if (bytes.byteLength > MAX_PDF_BYTES) throw new ValidationError(`“${name}” is larger than 300 MB, which is too big to store offline.`)
  if (!looksLikePdf(bytes)) throw new ValidationError(`“${name}” is not a PDF file.`)

  const sha256 = await sha256Hex(bytes)
  const existing = (await db.documents.toArray()).find((d) => d.sha256 === sha256 && d.deletedAt === null)
  if (existing) return { document: existing, duplicate: true }

  await ensureSpaceFor(bytes.byteLength)
  const info = await inspect(bytes)
  if (info.pageCount < 1) throw new ValidationError(`“${name}” has no pages.`)

  const fileKey = newId()
  const store = getFileStore()
  await store.put(fileKey, bytes)
  try {
    const fallbackTitle = name.replace(/\.pdf$/i, '').trim() || 'Untitled PDF'
    const document = await createRecord('documents', {
      title: (info.title && info.title.length > 3 ? info.title : fallbackTitle).slice(0, 120),
      subjectId: options.subjectId ?? null,
      folderId: null,
      fileName: name,
      byteSize: bytes.byteLength,
      pageCount: info.pageCount,
      fileKey,
      sha256,
      thumbnail: info.thumbnail,
      remotePath: null,
      fileSyncStatus: 'local',
      lastPage: 0,
      lastScale: 0,
      rotation: 0,
      lastOpenedAt: null,
      purgedAt: null,
    })
    return { document, duplicate: false }
  } catch (error) {
    // Roll back the binary so a failed import leaves no orphaned file behind.
    await store.remove(fileKey).catch(() => undefined)
    throw error
  }
}

type RemoteFileFetcher = (doc: Pick<PdfDocument, 'id' | 'fileKey' | 'remotePath'>) => Promise<Uint8Array>
let remoteFetcher: RemoteFileFetcher | null = null

/** Registered by the sync service when signed in, so cloud-only PDFs download on open. */
export function setRemoteFileFetcher(fetcher: RemoteFileFetcher | null): void {
  remoteFetcher = fetcher
}

export async function loadDocumentBytes(doc: Pick<PdfDocument, 'id' | 'fileKey' | 'fileSyncStatus' | 'remotePath'>): Promise<Uint8Array> {
  const bytes = await getFileStore().get(doc.fileKey)
  if (!bytes) {
    if (doc.remotePath && remoteFetcher) {
      try {
        return await remoteFetcher(doc)
      } catch (error) {
        throw new AppError('This PDF is in your cloud account but could not be downloaded. Check your connection and try again.', { cause: error })
      }
    }
    if (doc.fileSyncStatus === 'remote-only') {
      throw new AppError('This PDF is stored in your cloud account and has not been downloaded to this device yet. Connect to the internet and sync.')
    }
    throw new AppError('The PDF file is missing from this device. Restore it from a backup or re-import it.')
  }
  return bytes
}

export async function renameDocument(id: string, title: string): Promise<void> {
  await updateRecord('documents', id, { title: parseOrThrow(titleSchema, title) })
}

export async function moveDocument(id: string, subjectId: string | null): Promise<void> {
  await updateRecord('documents', id, { subjectId, folderId: null })
}

/** View state (page, zoom, rotation) is device-local UI state: no revision bump, no sync. */
export async function saveViewState(id: string, view: Partial<Pick<PdfDocument, 'lastPage' | 'lastScale' | 'rotation'>>): Promise<void> {
  await db.documents.update(id, view)
}

export async function markDocumentOpened(id: string): Promise<void> {
  await db.documents.update(id, { lastOpenedAt: Date.now() })
}
