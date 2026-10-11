import { db } from '../../db/database'
import {
  createRecord,
  restoreRecord,
  softDelete,
  softDeleteMany,
  updateIncludingDeleted,
  updateRecord,
} from '../../db/repository'
import type { Folder, Notebook, PageTemplate, Subject } from '../../db/types'
import { DAY_MS, now } from '../../lib/time'
import { colorSchema, parseOrThrow, titleSchema } from '../../lib/validation'
import { getFileStore } from '../../services/storage/fileStore'
import { PAGE_HEIGHT, PAGE_WIDTH, PALETTE, TRASH_RETENTION_DAYS } from './constants'

// ───────────── Subjects ─────────────

export async function createSubject(name: string, color: string = PALETTE[0]): Promise<Subject> {
  const count = await db.subjects.count()
  return createRecord('subjects', {
    name: parseOrThrow(titleSchema, name),
    color: parseOrThrow(colorSchema, color),
    sortOrder: count,
  })
}

export async function updateSubject(id: string, patch: { name?: string; color?: string }): Promise<void> {
  await updateRecord('subjects', id, {
    ...(patch.name !== undefined && { name: parseOrThrow(titleSchema, patch.name) }),
    ...(patch.color !== undefined && { color: parseOrThrow(colorSchema, patch.color) }),
  })
}

/** Deleting a subject never deletes its notebooks; they become "unsorted". */
export async function deleteSubject(id: string): Promise<void> {
  await db.transaction('rw', [db.subjects, db.folders, db.notebooks, db.documents, db.studySets, db.syncQueue], async () => {
    const [notebooks, documents, folders, sets] = await Promise.all([
      db.notebooks.where('subjectId').equals(id).toArray(),
      db.documents.where('subjectId').equals(id).toArray(),
      db.folders.where('subjectId').equals(id).toArray(),
      db.studySets.where('subjectId').equals(id).toArray(),
    ])
    for (const n of notebooks) await updateIncludingDeleted('notebooks', n.id, { subjectId: null, folderId: null })
    for (const d of documents) await updateIncludingDeleted('documents', d.id, { subjectId: null, folderId: null })
    for (const s of sets) await updateIncludingDeleted('studySets', s.id, { subjectId: null })
    await softDeleteMany('folders', folders.map((f) => f.id))
    await softDelete('subjects', id)
  })
}

// ───────────── Folders ─────────────

export async function createFolder(name: string, subjectId: string | null): Promise<Folder> {
  return createRecord('folders', { name: parseOrThrow(titleSchema, name), subjectId, parentId: null })
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await updateRecord('folders', id, { name: parseOrThrow(titleSchema, name) })
}

export async function deleteFolder(id: string): Promise<void> {
  await db.transaction('rw', [db.folders, db.notebooks, db.documents, db.syncQueue], async () => {
    const notebooks = await db.notebooks.where('folderId').equals(id).toArray()
    const documents = await db.documents.where('folderId').equals(id).toArray()
    for (const n of notebooks) await updateIncludingDeleted('notebooks', n.id, { folderId: null })
    for (const d of documents) await updateIncludingDeleted('documents', d.id, { folderId: null })
    await softDelete('folders', id)
  })
}

// ───────────── Notebooks ─────────────

export interface NewNotebookInput {
  title: string
  subjectId?: string | null
  folderId?: string | null
  color?: string
  template?: PageTemplate
}

/** Creates the notebook and its first page atomically. */
export async function createNotebook(input: NewNotebookInput): Promise<Notebook> {
  const title = parseOrThrow(titleSchema, input.title)
  const template = input.template ?? 'lined'
  return db.transaction('rw', [db.notebooks, db.pages, db.syncQueue], async () => {
    const notebook = await createRecord('notebooks', {
      title,
      subjectId: input.subjectId ?? null,
      folderId: input.folderId ?? null,
      color: parseOrThrow(colorSchema, input.color ?? PALETTE[0]),
      defaultTemplate: template,
      pinned: false,
      lastOpenedAt: null,
      purgedAt: null,
    })
    await createRecord('pages', {
      notebookId: notebook.id,
      sortKey: 1,
      template,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      strokes: [],
      textBlocks: [],
      plainText: '',
    })
    return notebook
  })
}

export async function updateNotebook(
  id: string,
  patch: Partial<Pick<Notebook, 'title' | 'subjectId' | 'folderId' | 'color' | 'defaultTemplate' | 'pinned'>>,
): Promise<Notebook> {
  return updateRecord('notebooks', id, {
    ...patch,
    ...(patch.title !== undefined && { title: parseOrThrow(titleSchema, patch.title) }),
    ...(patch.color !== undefined && { color: parseOrThrow(colorSchema, patch.color) }),
  })
}

/**
 * Records that the notebook was opened. This is local UI state — written directly without
 * bumping the revision, so merely opening a notebook never creates sync traffic.
 */
export async function markNotebookOpened(id: string): Promise<void> {
  await db.notebooks.update(id, { lastOpenedAt: now() })
}

/** Moves a notebook to the trash. Content is kept until purged. */
export async function trashNotebook(id: string): Promise<void> {
  await softDelete('notebooks', id)
}

export async function restoreNotebook(id: string): Promise<void> {
  await restoreRecord('notebooks', id)
}

/**
 * Permanently deletes notebook content. Tombstones are kept (with content stripped) so the
 * deletion can propagate to other devices.
 */
export async function purgeNotebook(id: string): Promise<void> {
  await db.transaction('rw', [db.notebooks, db.pages, db.syncQueue], async () => {
    const pages = await db.pages.where('notebookId').equals(id).toArray()
    await softDeleteMany(
      'pages',
      pages.map((p) => p.id),
      { strokes: [], textBlocks: [], plainText: '' },
    )
    await updateIncludingDeleted('notebooks', id, { deletedAt: now(), purgedAt: now(), title: 'Deleted notebook' })
  })
}

export async function trashDocument(id: string): Promise<void> {
  await softDelete('documents', id)
}

export async function restoreDocument(id: string): Promise<void> {
  await restoreRecord('documents', id)
}

export async function purgeDocument(id: string): Promise<void> {
  const doc = await db.documents.get(id)
  if (!doc) return
  await db.transaction('rw', [db.documents, db.annotations, db.syncQueue], async () => {
    const annotations = await db.annotations.where('documentId').equals(id).primaryKeys()
    await softDeleteMany('annotations', annotations)
    await updateIncludingDeleted('documents', id, {
      deletedAt: doc.deletedAt ?? now(),
      purgedAt: now(),
      thumbnail: null,
      title: 'Deleted document',
    })
  })
  // The binary is removed only after the metadata commit, so a crash can at worst leave an
  // orphaned file (reclaimed by cleanupOrphanFiles) — never a document pointing to nothing.
  await getFileStore().remove(doc.fileKey)
}

/** Permanently removes items that have been in the trash longer than the retention period. */
export async function purgeExpiredTrash(at = now()): Promise<number> {
  const cutoff = at - TRASH_RETENTION_DAYS * DAY_MS
  const expired = (r: { deletedAt: number | null; purgedAt: number | null }) =>
    r.deletedAt !== null && r.purgedAt === null && r.deletedAt < cutoff
  const notebooks = await db.notebooks.filter(expired).toArray()
  const documents = await db.documents.filter(expired).toArray()
  for (const n of notebooks) await purgeNotebook(n.id)
  for (const d of documents) await purgeDocument(d.id)
  return notebooks.length + documents.length
}
