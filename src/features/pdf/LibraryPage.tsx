import { useMemo, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { FileText, FileUp, FolderInput, GraduationCap, MoreVertical, Pencil, Trash2, Upload } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Menu } from '../../components/ui/Menu'
import { NameDialog } from '../../components/ui/NameDialog'
import { EmptyState, PageHeader, Spinner } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import type { PdfDocument } from '../../db/types'
import { cn } from '../../lib/cn'
import { toUserMessage } from '../../lib/errors'
import { formatBytes, formatRelative } from '../../lib/time'
import { useDocuments, useSubjects } from '../library/hooks'
import { restoreDocument, trashDocument } from '../library/libraryService'
import { moveDocument, renameDocument } from './documentService'
import { importPdfFiles, pickAndImportPdfs } from './importPdfs'

export function LibraryPage() {
  const documents = useDocuments()
  const subjectList = useSubjects()
  const navigate = useNavigate()
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<PdfDocument | null>(null)
  const [moving, setMoving] = useState<PdfDocument | null>(null)

  const subjects = useMemo(() => subjectList ?? [], [subjectList])
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const visible = (documents ?? []).filter((d) => !subjectFilter || d.subjectId === subjectFilter)

  const runImport = async (op: () => Promise<PdfDocument[]>) => {
    setBusy(true)
    try {
      const imported = await op()
      if (imported.length === 1) navigate(`/library/${imported[0]!.id}`)
    } finally {
      setBusy(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (files.length === 0) {
      toast.warning('Only PDF files can be imported here.')
      return
    }
    void runImport(() => importPdfFiles(files, subjectFilter))
  }

  const onTrash = async (d: PdfDocument) => {
    try {
      await trashDocument(d.id)
      toast.info(`“${d.title}” moved to trash.`, { action: { label: 'Undo', onAction: () => void restoreDocument(d.id) } })
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
      className="relative min-h-[60vh]"
    >
      <PageHeader
        title="PDF library"
        description="Lecture slides, readings and past papers — stored on this device and annotatable offline."
        actions={
          <Button icon={<Upload className="size-4" />} loading={busy} onClick={() => void runImport(() => pickAndImportPdfs(subjectFilter))}>
            Import PDF
          </Button>
        }
      />

      {subjects.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="toolbar" aria-label="Filter by subject">
          {[{ id: null, name: 'All', color: undefined as string | undefined }, ...subjects].map((s) => (
            <button
              key={s.id ?? 'all'}
              type="button"
              aria-pressed={subjectFilter === s.id}
              onClick={() => setSubjectFilter(s.id)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium',
                subjectFilter === s.id ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              {s.color && <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />}
              {s.name}
            </button>
          ))}
        </div>
      )}

      {!documents ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={documents.length === 0 ? 'Your PDF library is empty' : 'No PDFs in this subject'}
          description="Import a PDF to read and annotate it — even without internet. Your original file is never changed."
          action={
            <Button icon={<FileUp className="size-4" />} onClick={() => void runImport(() => pickAndImportPdfs(subjectFilter))}>
              Import PDF
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((d) => {
            const subject = d.subjectId ? subjectById.get(d.subjectId) : undefined
            return (
              <li key={d.id} className="group relative">
                <Link to={`/library/${d.id}`} className="block overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
                  <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-surface-2">
                    {d.thumbnail ? (
                      <img src={d.thumbnail} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
                    ) : (
                      <FileText className="size-10 text-muted" aria-hidden />
                    )}
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {subject ? `${subject.name} · ` : ''}
                      {d.pageCount} pages · {formatBytes(d.byteSize)}
                    </p>
                    <p className="text-xs text-muted">{formatRelative(d.lastOpenedAt ?? d.updatedAt)}</p>
                  </div>
                </Link>
                <div className="absolute top-2 right-2 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                  <Menu
                    items={[
                      { label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(d) },
                      { label: 'Move to subject', icon: <FolderInput />, onSelect: () => setMoving(d) },
                      { label: 'Make a study set', icon: <GraduationCap />, onSelect: () => navigate(`/study/generate?document=${d.id}`) },
                      'separator',
                      { label: 'Move to trash', icon: <Trash2 />, danger: true, onSelect: () => void onTrash(d) },
                    ]}
                    trigger={(p) => (
                      <button
                        type="button"
                        {...p}
                        aria-label={`Options for ${d.title}`}
                        className="flex size-8 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-sm hover:bg-white"
                      >
                        <MoreVertical className="size-4" />
                      </button>
                    )}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary bg-primary-soft/80">
          <p className="flex items-center gap-2 text-lg font-semibold text-primary">
            <FileUp className="size-6" /> Drop PDFs to import
          </p>
        </div>
      )}

      <NameDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename PDF"
        label="Title"
        initialValue={renaming?.title ?? ''}
        onSubmit={(name) => renameDocument(renaming!.id, name)}
      />

      <Dialog open={!!moving} onClose={() => setMoving(null)} title="Move to subject" size="sm">
        <ul className="flex flex-col gap-1">
          {[{ id: null, name: 'No subject', color: '#94a3b8' }, ...subjects].map((s) => (
            <li key={s.id ?? 'none'}>
              <button
                type="button"
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2', moving?.subjectId === s.id && 'bg-primary-soft text-primary')}
                onClick={async () => {
                  try {
                    await moveDocument(moving!.id, s.id)
                    setMoving(null)
                  } catch (err) {
                    toast.error(toUserMessage(err))
                  }
                }}
              >
                <span className="size-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  )
}
