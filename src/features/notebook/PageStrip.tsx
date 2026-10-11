import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import type { Page, PageContent } from '../../db/types'
import { cn } from '../../lib/cn'
import { IconButton } from '../../components/ui/Button'
import { PageThumb } from './PageThumb'

interface Props {
  pages: Page[]
  currentId: string | null
  contentFor: (page: Page) => PageContent
  onSelect: (id: string) => void
  onAdd: () => void
  onMove: (id: string, toIndex: number) => void
}

export function PageStrip({ pages, currentId, contentFor, onSelect, onAdd, onMove }: Props) {
  return (
    <nav aria-label="Pages" className="flex h-full flex-col">
      <ol className="flex-1 space-y-3 overflow-y-auto p-3">
        {pages.map((page, i) => {
          const active = page.id === currentId
          return (
            <li key={page.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(page.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={`Page ${i + 1}`}
                className={cn(
                  'block w-full rounded-lg p-1 transition-colors',
                  active ? 'bg-primary-soft ring-2 ring-primary' : 'hover:bg-surface-2',
                )}
              >
                <PageThumb content={contentFor(page)} template={page.template} pageWidth={page.width} pageHeight={page.height} width={112} />
                <span className={cn('mt-1 block text-center text-xs', active ? 'font-semibold text-primary' : 'text-muted')}>{i + 1}</span>
              </button>
              <div className="absolute top-2 right-2 hidden flex-col gap-1 group-focus-within:flex group-hover:flex">
                <IconButton label={`Move page ${i + 1} up`} size="sm" variant="secondary" disabled={i === 0} onClick={() => onMove(page.id, i - 1)}>
                  <ChevronUp className="size-4" />
                </IconButton>
                <IconButton
                  label={`Move page ${i + 1} down`}
                  size="sm"
                  variant="secondary"
                  disabled={i === pages.length - 1}
                  onClick={() => onMove(page.id, i + 1)}
                >
                  <ChevronDown className="size-4" />
                </IconButton>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
        >
          <Plus className="size-4" /> Add page
        </button>
      </div>
    </nav>
  )
}
