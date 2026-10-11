import { BookOpen, FileText, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { EmptyState, PageHeader, Spinner } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import { toUserMessage } from '../../lib/errors'
import { DAY_MS, formatRelative } from '../../lib/time'
import { useNow } from '../../hooks/useNow'
import { TRASH_RETENTION_DAYS } from './constants'
import { useTrash } from './hooks'
import { purgeDocument, purgeNotebook, restoreDocument, restoreNotebook } from './libraryService'

export function TrashPage() {
  const trash = useTrash()
  const confirm = useConfirm()
  const nowMs = useNow()

  const run = async (op: () => Promise<void>, message: string) => {
    try {
      await op()
      toast.success(message)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const purge = async (title: string, op: () => Promise<void>) => {
    const ok = await confirm({
      title: `Permanently delete “${title}”?`,
      message: 'This cannot be undone. If you have not exported a backup, the content will be lost for good.',
      confirmLabel: 'Delete forever',
      destructive: true,
    })
    if (ok) await run(op, 'Permanently deleted')
  }

  const items = trash
    ? [
        ...trash.notebooks.map((n) => ({ kind: 'notebook' as const, id: n.id, title: n.title, deletedAt: n.deletedAt! })),
        ...trash.documents.map((d) => ({ kind: 'document' as const, id: d.id, title: d.title, deletedAt: d.deletedAt! })),
      ].sort((a, b) => b.deletedAt - a.deletedAt)
    : undefined

  return (
    <div>
      <PageHeader
        title="Trash"
        description={`Deleted notebooks and PDFs can be restored for ${TRASH_RETENTION_DAYS} days, then they are removed permanently.`}
      />
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash2 />} title="Trash is empty" description="Items you delete will appear here so you can restore them." />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((item) => {
            const daysLeft = Math.max(0, Math.ceil((item.deletedAt + TRASH_RETENTION_DAYS * DAY_MS - nowMs) / DAY_MS))
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
                  {item.kind === 'notebook' ? <BookOpen className="size-5" /> : <FileText className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="text-xs text-muted">
                    Deleted {formatRelative(item.deletedAt)} · removed in {daysLeft} day{daysLeft === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RotateCcw className="size-4" />}
                    onClick={() =>
                      run(() => (item.kind === 'notebook' ? restoreNotebook(item.id) : restoreDocument(item.id)), `Restored “${item.title}”`)
                    }
                  >
                    Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => purge(item.title, () => (item.kind === 'notebook' ? purgeNotebook(item.id) : purgeDocument(item.id)))}
                  >
                    Delete forever
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
