import { db } from '../../db/database'
import { createRecord, restoreRecord, softDelete, stampNew, updateRecord } from '../../db/repository'
import type { Annotation, AnnotationShape } from '../../db/types'

export type NewAnnotation = Pick<Annotation, 'documentId' | 'pageIndex' | 'color' | 'opacity' | 'shape'>

/** Builds a complete record locally (stable id) so the UI can show it before it is stored. */
export function buildAnnotation(input: NewAnnotation): Annotation {
  return stampNew<'annotations'>(input)
}

export async function listAnnotations(documentId: string): Promise<Annotation[]> {
  return (await db.annotations.where('documentId').equals(documentId).toArray()).filter((a) => a.deletedAt === null)
}

/**
 * Idempotent persistence operations. Each can be retried safely after a failure: inserting
 * an existing id updates it, deleting a deleted record is a no-op.
 */
export async function persistAdd(annotation: Annotation): Promise<void> {
  const existing = await db.annotations.get(annotation.id)
  if (!existing) {
    await createRecord('annotations', annotation)
  } else if (existing.deletedAt !== null) {
    await restoreRecord('annotations', annotation.id)
  }
}

export async function persistRemove(id: string): Promise<void> {
  const existing = await db.annotations.get(id)
  if (existing && existing.deletedAt === null) await softDelete('annotations', id)
}

export async function persistUpdate(id: string, patch: { shape?: AnnotationShape; color?: string }): Promise<void> {
  const existing = await db.annotations.get(id)
  if (existing && existing.deletedAt === null) await updateRecord('annotations', id, patch)
}
