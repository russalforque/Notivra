import { Link } from 'react-router'
import { MoreVertical, Pin } from 'lucide-react'
import type { Notebook, Subject } from '../../db/types'
import { formatRelative } from '../../lib/time'
import { Menu, type MenuItem } from '../../components/ui/Menu'

interface Props {
  notebook: Notebook
  subject?: Subject
  menuItems: (MenuItem | 'separator')[]
}

/** Notebook rendered as a physical-looking cover with a spine in the notebook colour. */
export function NotebookCard({ notebook, subject, menuItems }: Props) {
  return (
    <div className="group relative">
      <Link
        to={`/notebooks/${notebook.id}`}
        className="block overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md focus-visible:shadow-md"
      >
        <div className="relative aspect-[4/5] overflow-hidden" style={{ backgroundColor: notebook.color }}>
          <div className="absolute inset-y-0 left-0 w-3 bg-black/15" aria-hidden />
          <div className="absolute inset-y-0 left-3 w-px bg-white/25" aria-hidden />
          <div className="absolute inset-x-5 top-6 rounded-lg bg-white/90 px-3 py-2 shadow-sm">
            <p className="line-clamp-3 text-sm font-semibold break-words text-gray-900">{notebook.title}</p>
          </div>
          {notebook.pinned && (
            <span className="absolute right-3 bottom-3 rounded-full bg-white/90 p-1.5 text-gray-800" title="Pinned">
              <Pin className="size-3.5" aria-label="Pinned" />
            </span>
          )}
        </div>
        <div className="px-3 py-2.5">
          <p className="truncate text-sm font-medium">{notebook.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
            {subject && <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: subject.color }} aria-hidden />}
            {subject ? `${subject.name} · ` : ''}
            {formatRelative(notebook.updatedAt)}
          </p>
        </div>
      </Link>
      <div className="absolute top-2 right-2 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        <Menu
          items={menuItems}
          trigger={(p) => (
            <button
              type="button"
              {...p}
              aria-label={`Options for ${notebook.title}`}
              className="flex size-8 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-sm hover:bg-white"
            >
              <MoreVertical className="size-4" />
            </button>
          )}
        />
      </div>
    </div>
  )
}
