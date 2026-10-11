import { db } from '../../db/database'

export type SearchHit =
  | { kind: 'notebook'; id: string; title: string; snippet: string | null; href: string }
  | { kind: 'page'; id: string; title: string; snippet: string; href: string; pageNumber: number }
  | { kind: 'document'; id: string; title: string; snippet: string | null; href: string }
  | { kind: 'studySet'; id: string; title: string; snippet: string | null; href: string }

function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function makeSnippet(text: string, query: string, radius = 60): string | null {
  const idx = normalize(text).indexOf(normalize(query))
  if (idx < 0) return null
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + query.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}

/**
 * Local full-text search over titles, typed page text and study sets. Linear scan is fine for
 * a single student's library (thousands of records) and needs no extra index maintenance.
 */
export async function search(query: string, limit = 60): Promise<SearchHit[]> {
  const q = normalize(query.trim())
  if (q.length < 2) return []
  const has = (s: string | null | undefined) => !!s && normalize(s).includes(q)
  const hits: SearchHit[] = []

  const notebooks = (await db.notebooks.toArray()).filter((n) => n.deletedAt === null)
  const liveNotebooks = new Map(notebooks.map((n) => [n.id, n]))
  for (const n of notebooks) {
    if (has(n.title)) hits.push({ kind: 'notebook', id: n.id, title: n.title, snippet: null, href: `/notebooks/${n.id}` })
  }

  // Page order within notebooks, to report human page numbers.
  const pages = (await db.pages.toArray()).filter((p) => p.deletedAt === null && liveNotebooks.has(p.notebookId))
  const byNotebook = new Map<string, typeof pages>()
  for (const p of pages) byNotebook.set(p.notebookId, [...(byNotebook.get(p.notebookId) ?? []), p])
  for (const list of byNotebook.values()) {
    list.sort((a, b) => a.sortKey - b.sortKey)
    list.forEach((p, i) => {
      if (!has(p.plainText)) return
      const nb = liveNotebooks.get(p.notebookId)!
      hits.push({
        kind: 'page',
        id: p.id,
        title: nb.title,
        pageNumber: i + 1,
        snippet: makeSnippet(p.plainText, query.trim()) ?? '',
        href: `/notebooks/${nb.id}?page=${p.id}`,
      })
    })
  }

  for (const d of (await db.documents.toArray()).filter((d) => d.deletedAt === null)) {
    if (has(d.title) || has(d.fileName)) hits.push({ kind: 'document', id: d.id, title: d.title, snippet: d.fileName, href: `/library/${d.id}` })
  }

  const sets = (await db.studySets.toArray()).filter((s) => s.deletedAt === null)
  const items = (await db.studyItems.toArray()).filter((i) => i.deletedAt === null)
  for (const s of sets) {
    const matchItem = items.find((i) => i.setId === s.id && (has(i.prompt) || has(i.answer)))
    if (has(s.title) || has(s.description) || has(s.summary) || matchItem) {
      const snippet = matchItem
        ? (makeSnippet(`${matchItem.prompt} — ${matchItem.answer}`, query.trim()) ?? matchItem.prompt)
        : s.summary
          ? makeSnippet(s.summary, query.trim())
          : null
      hits.push({ kind: 'studySet', id: s.id, title: s.title, snippet, href: `/study/sets/${s.id}` })
    }
  }

  return hits.slice(0, limit)
}
