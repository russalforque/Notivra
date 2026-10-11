import { db } from '../../db/database'
import { createRecord, restoreRecord, softDelete, updateRecord } from '../../db/repository'
import type { Page, PageContent, PageTemplate } from '../../db/types'
import { now } from '../../lib/time'
import { PAGE_HEIGHT, PAGE_WIDTH } from '../library/constants'

export async function listPages(notebookId: string): Promise<Page[]> {
  const pages = await db.pages.where('[notebookId+sortKey]').between([notebookId, -Infinity], [notebookId, Infinity]).toArray()
  return pages.filter((p) => p.deletedAt === null)
}

/** Sort key strictly between two neighbours (fractional indexing). */
export function sortKeyBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1
  if (before === null) return after! - 1
  if (after === null) return before + 1
  return (before + after) / 2
}

export async function addPage(notebookId: string, afterPageId: string | null, template: PageTemplate): Promise<Page> {
  const pages = await listPages(notebookId)
  const index = afterPageId ? pages.findIndex((p) => p.id === afterPageId) : pages.length - 1
  const before = index >= 0 ? pages[index]!.sortKey : null
  const after = index + 1 < pages.length ? pages[index + 1]!.sortKey : null
  return db.transaction('rw', [db.pages, db.notebooks, db.syncQueue], async () => {
    const page = await createRecord('pages', {
      notebookId,
      sortKey: sortKeyBetween(before, after),
      template,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      strokes: [],
      textBlocks: [],
      plainText: '',
    })
    await touchNotebook(notebookId)
    return page
  })
}

export function extractPlainText(content: PageContent): string {
  return content.textBlocks
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Persists page content. `expectedRev` guards against silently overwriting a newer version
 * written by another tab; on mismatch a ConflictError is thrown and nothing is written.
 */
export async function savePageContent(pageId: string, content: PageContent, expectedRev: number): Promise<Page> {
  return db.transaction('rw', [db.pages, db.notebooks, db.syncQueue], async () => {
    const page = await updateRecord(
      'pages',
      pageId,
      { strokes: content.strokes, textBlocks: content.textBlocks, plainText: extractPlainText(content) },
      { expectedRev },
    )
    await touchNotebook(page.notebookId)
    return page
  })
}

export async function setPageTemplate(pageId: string, template: PageTemplate): Promise<Page> {
  return updateRecord('pages', pageId, { template })
}

export async function movePage(notebookId: string, pageId: string, toIndex: number): Promise<void> {
  const pages = (await listPages(notebookId)).filter((p) => p.id !== pageId)
  const clamped = Math.max(0, Math.min(toIndex, pages.length))
  const before = clamped > 0 ? pages[clamped - 1]!.sortKey : null
  const after = clamped < pages.length ? pages[clamped]!.sortKey : null
  await updateRecord('pages', pageId, { sortKey: sortKeyBetween(before, after) })
}

export async function deletePage(pageId: string): Promise<void> {
  await softDelete('pages', pageId)
}

export async function restorePage(pageId: string): Promise<void> {
  await restoreRecord('pages', pageId)
}

/**
 * Refreshes the notebook's updatedAt so "recent" lists reflect page edits. Deliberately does
 * NOT bump the revision: two devices editing different pages must not conflict on the
 * notebook record itself.
 */
async function touchNotebook(notebookId: string): Promise<void> {
  await db.notebooks.update(notebookId, { updatedAt: now() })
}
