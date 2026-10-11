import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import type { Folder, Notebook, PdfDocument, Subject } from '../../db/types'

const live = <T extends { deletedAt: number | null }>(r: T) => r.deletedAt === null

export function useSubjects(): Subject[] | undefined {
  return useLiveQuery(async () => (await db.subjects.orderBy('sortOrder').toArray()).filter(live), [])
}

export function useFolders(): Folder[] | undefined {
  return useLiveQuery(async () => (await db.folders.toArray()).filter(live).sort((a, b) => a.name.localeCompare(b.name)), [])
}

export function useNotebooks(): Notebook[] | undefined {
  return useLiveQuery(async () => (await db.notebooks.orderBy('updatedAt').reverse().toArray()).filter(live), [])
}

export function useNotebook(id: string | undefined): Notebook | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.notebooks.get(id)) ?? null) : null), [id])
}

export function useDocuments(): PdfDocument[] | undefined {
  return useLiveQuery(async () => (await db.documents.orderBy('updatedAt').reverse().toArray()).filter(live), [])
}

export function useTrash() {
  return useLiveQuery(async () => {
    const inTrash = <T extends { deletedAt: number | null; purgedAt: number | null }>(r: T) =>
      r.deletedAt !== null && r.purgedAt === null
    const [notebooks, documents] = await Promise.all([
      db.notebooks.filter(inTrash).toArray(),
      db.documents.filter(inTrash).toArray(),
    ])
    return { notebooks, documents }
  }, [])
}
