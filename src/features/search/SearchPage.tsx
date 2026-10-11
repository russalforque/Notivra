import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { BookOpen, FileText, GraduationCap, Search as SearchIcon, StickyNote } from 'lucide-react'
import { Input } from '../../components/ui/Field'
import { EmptyState, PageHeader } from '../../components/ui/misc'
import { search, type SearchHit } from './searchService'

const icons = { notebook: BookOpen, page: StickyNote, document: FileText, studySet: GraduationCap }
const labels = { notebook: 'Notebook', page: 'Page', document: 'PDF', studySet: 'Study set' }

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [results, setResults] = useState<SearchHit[] | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => {
      setParams(query ? { q: query } : {}, { replace: true })
      if (query.trim().length < 2) {
        setResults(null)
        return
      }
      search(query).then(setResults, () => setResults([]))
    }, 200)
    return () => clearTimeout(handle)
  }, [query, setParams])

  return (
    <div>
      <PageHeader title="Search" description="Search notebook titles, typed notes, PDFs and study sets on this device." />
      <div className="relative mb-6">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          type="search"
          aria-label="Search"
          placeholder="Search your notes…"
          className="h-12 pl-10 text-base"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      {results === null ? (
        <p className="text-sm text-muted">Type at least 2 characters. Handwriting is not searchable yet — typed text boxes are.</p>
      ) : results.length === 0 ? (
        <EmptyState icon={<SearchIcon />} title="No results" description={`Nothing matched “${query}”.`} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface" aria-live="polite">
          {results.map((hit) => {
            const Icon = icons[hit.kind]
            return (
              <li key={`${hit.kind}-${hit.id}`}>
                <Link to={hit.href} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {hit.title}
                      {hit.kind === 'page' && <span className="font-normal text-muted"> · page {hit.pageNumber}</span>}
                    </span>
                    <span className="block text-xs text-muted">{labels[hit.kind]}</span>
                    {hit.snippet && <span className="mt-1 block text-sm text-muted">{hit.snippet}</span>}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
