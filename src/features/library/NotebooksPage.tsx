import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  ArrowDownAZ,
  BookOpen,
  Clock,
  Download,
  FolderPlus,
  FolderOpen,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { Menu } from '../../components/ui/Menu'
import { NameDialog } from '../../components/ui/NameDialog'
import { ColorSwatches, EmptyState, PageHeader, Spinner } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import type { Folder, Notebook, Subject } from '../../db/types'
import { cn } from '../../lib/cn'
import { toUserMessage } from '../../lib/errors'
import { useFolders, useNotebooks, useSubjects } from './hooks'
import { NotebookCard } from './NotebookCard'
import { NotebookDialog } from './NotebookDialog'
import { PALETTE } from './constants'
import {
  createFolder,
  createSubject,
  deleteFolder,
  deleteSubject,
  renameFolder,
  restoreNotebook,
  trashNotebook,
  updateNotebook,
  updateSubject,
} from './libraryService'
import { exportNotebookFile, importNotebookFile } from './transfer'

type SortMode = 'recent' | 'name'

type NameDialogState =
  | { kind: 'new-subject' }
  | { kind: 'edit-subject'; subject: Subject }
  | { kind: 'new-folder'; subjectId: string }
  | { kind: 'rename-folder'; folder: Folder }
  | null

export function NotebooksPage() {
  const notebooks = useNotebooks()
  const subjects = useSubjects()
  const folders = useFolders() ?? []
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const subjectFilter = params.get('subject') // null = all, 'none' = unsorted
  const folderFilter = params.get('folder')
  const [sort, setSort] = useState<SortMode>('recent')
  const [notebookDialog, setNotebookDialog] = useState<{ open: boolean; notebook?: Notebook }>({ open: false })
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null)
  const [subjectColor, setSubjectColor] = useState<string>(PALETTE[1])

  const subjectById = useMemo(() => new Map((subjects ?? []).map((s) => [s.id, s])), [subjects])
  const activeSubject = subjectFilter && subjectFilter !== 'none' ? subjectById.get(subjectFilter) : undefined
  const subjectFolders = activeSubject ? folders.filter((f) => f.subjectId === activeSubject.id) : []

  const visible = useMemo(() => {
    let list = notebooks ?? []
    if (subjectFilter === 'none') list = list.filter((n) => !n.subjectId)
    else if (subjectFilter) list = list.filter((n) => n.subjectId === subjectFilter)
    if (folderFilter) list = list.filter((n) => n.folderId === folderFilter)
    const sorted = [...list].sort((a, b) =>
      sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt,
    )
    return [...sorted.filter((n) => n.pinned), ...sorted.filter((n) => !n.pinned)]
  }, [notebooks, subjectFilter, folderFilter, sort])

  const setFilter = (subject: string | null, folder: string | null = null) => {
    const next = new URLSearchParams()
    if (subject) next.set('subject', subject)
    if (folder) next.set('folder', folder)
    setParams(next, { replace: true })
  }

  const run = async (op: () => Promise<unknown>, success?: string) => {
    try {
      await op()
      if (success) toast.success(success)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const onTrash = async (n: Notebook) => {
    await run(() => trashNotebook(n.id))
    toast.info(`“${n.title}” moved to trash.`, {
      action: { label: 'Undo', onAction: () => void run(() => restoreNotebook(n.id)) },
    })
  }

  const onImport = async () => {
    try {
      const report = await importNotebookFile()
      if (report) toast.success(`Imported: ${report.added} new, ${report.updated} updated, ${report.skipped} unchanged.`)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const notebookMenu = (n: Notebook) => [
    { label: 'Rename & settings', icon: <Pencil />, onSelect: () => setNotebookDialog({ open: true, notebook: n }) },
    {
      label: n.pinned ? 'Unpin' : 'Pin to top',
      icon: n.pinned ? <PinOff /> : <Pin />,
      onSelect: () => void run(() => updateNotebook(n.id, { pinned: !n.pinned })),
    },
    { label: 'Export notebook file', icon: <Download />, onSelect: () => void run(() => exportNotebookFile(n), 'Notebook exported') },
    'separator' as const,
    { label: 'Move to trash', icon: <Trash2 />, danger: true, onSelect: () => void onTrash(n) },
  ]

  return (
    <div>
      <PageHeader
        title="My notebooks"
        description="Organize notes by subject. Everything is saved on this device as you write."
        actions={
          <>
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={onImport}>
              Import
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setNotebookDialog({ open: true })}>
              New notebook
            </Button>
          </>
        }
      />

      {/* Subject filter */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1" role="toolbar" aria-label="Filter by subject">
        <FilterChip active={!subjectFilter} onClick={() => setFilter(null)}>
          All
        </FilterChip>
        {(subjects ?? []).map((s) => (
          <FilterChip key={s.id} active={subjectFilter === s.id} onClick={() => setFilter(s.id)} color={s.color}>
            {s.name}
          </FilterChip>
        ))}
        <FilterChip active={subjectFilter === 'none'} onClick={() => setFilter('none')}>
          Unsorted
        </FilterChip>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus className="size-4" />}
          onClick={() => {
            setSubjectColor(PALETTE[(subjects?.length ?? 0) % PALETTE.length]!)
            setNameDialog({ kind: 'new-subject' })
          }}
        >
          Subject
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton label="Sort by recent" size="sm" active={sort === 'recent'} onClick={() => setSort('recent')}>
            <Clock className="size-4" />
          </IconButton>
          <IconButton label="Sort by name" size="sm" active={sort === 'name'} onClick={() => setSort('name')}>
            <ArrowDownAZ className="size-4" />
          </IconButton>
        </div>
      </div>

      {/* Folders of the active subject */}
      {activeSubject && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-2">
          <span className="flex items-center gap-2 px-2 text-sm font-semibold">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: activeSubject.color }} aria-hidden />
            {activeSubject.name}
          </span>
          <FilterChip active={!folderFilter} onClick={() => setFilter(activeSubject.id)}>
            All folders
          </FilterChip>
          {subjectFolders.map((f) => (
            <div key={f.id} className="flex items-center">
              <FilterChip active={folderFilter === f.id} onClick={() => setFilter(activeSubject.id, f.id)}>
                <FolderOpen className="size-3.5" aria-hidden />
                {f.name}
              </FilterChip>
              <Menu
                items={[
                  { label: 'Rename folder', icon: <Pencil />, onSelect: () => setNameDialog({ kind: 'rename-folder', folder: f }) },
                  {
                    label: 'Delete folder',
                    icon: <Trash2 />,
                    danger: true,
                    onSelect: async () => {
                      const ok = await confirm({
                        title: `Delete folder “${f.name}”?`,
                        message: 'Notebooks in this folder are kept and moved out of the folder.',
                        confirmLabel: 'Delete folder',
                        destructive: true,
                      })
                      if (ok) {
                        await run(() => deleteFolder(f.id), 'Folder deleted')
                        setFilter(activeSubject.id)
                      }
                    },
                  },
                ]}
                trigger={(p) => (
                  <IconButton {...p} label={`Folder options for ${f.name}`} size="sm">
                    <MoreHorizontal className="size-4" />
                  </IconButton>
                )}
              />
            </div>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={<FolderPlus className="size-4" />} onClick={() => setNameDialog({ kind: 'new-folder', subjectId: activeSubject.id })}>
              Folder
            </Button>
            <Menu
              items={[
                {
                  label: 'Rename / color',
                  icon: <Palette />,
                  onSelect: () => {
                    setSubjectColor(activeSubject.color)
                    setNameDialog({ kind: 'edit-subject', subject: activeSubject })
                  },
                },
                {
                  label: 'Delete subject',
                  icon: <Trash2 />,
                  danger: true,
                  onSelect: async () => {
                    const ok = await confirm({
                      title: `Delete subject “${activeSubject.name}”?`,
                      message: 'Notebooks, PDFs and study sets in this subject are kept and become unsorted. Its folders are removed.',
                      confirmLabel: 'Delete subject',
                      destructive: true,
                    })
                    if (ok) {
                      await run(() => deleteSubject(activeSubject.id), 'Subject deleted')
                      setFilter(null)
                    }
                  },
                },
              ]}
              trigger={(p) => (
                <IconButton {...p} label="Subject options" size="sm">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              )}
            />
          </div>
        </div>
      )}

      {!notebooks ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={notebooks.length === 0 ? 'No notebooks yet' : 'Nothing here'}
          description={
            notebooks.length === 0
              ? 'Create your first notebook to start writing, drawing and highlighting — no account or internet needed.'
              : 'No notebooks match this filter.'
          }
          action={
            <Button icon={<Plus className="size-4" />} onClick={() => setNotebookDialog({ open: true })}>
              New notebook
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((n) => (
            <li key={n.id}>
              <NotebookCard notebook={n} subject={n.subjectId ? subjectById.get(n.subjectId) : undefined} menuItems={notebookMenu(n)} />
            </li>
          ))}
        </ul>
      )}

      <NotebookDialog
        open={notebookDialog.open}
        notebook={notebookDialog.notebook}
        defaultSubjectId={activeSubject?.id ?? null}
        onClose={() => setNotebookDialog({ open: false })}
      />

      <NameDialog
        open={nameDialog?.kind === 'new-subject' || nameDialog?.kind === 'edit-subject'}
        onClose={() => setNameDialog(null)}
        title={nameDialog?.kind === 'edit-subject' ? 'Edit subject' : 'New subject'}
        label="Subject name"
        placeholder="e.g. Biology"
        initialValue={nameDialog?.kind === 'edit-subject' ? nameDialog.subject.name : ''}
        submitLabel={nameDialog?.kind === 'edit-subject' ? 'Save' : 'Create subject'}
        extra={
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Color</span>
            <ColorSwatches colors={PALETTE} value={subjectColor} onChange={setSubjectColor} label="Subject color" />
          </div>
        }
        onSubmit={async (name) => {
          if (nameDialog?.kind === 'edit-subject') await updateSubject(nameDialog.subject.id, { name, color: subjectColor })
          else {
            const s = await createSubject(name, subjectColor)
            setFilter(s.id)
          }
        }}
      />

      <NameDialog
        open={nameDialog?.kind === 'new-folder' || nameDialog?.kind === 'rename-folder'}
        onClose={() => setNameDialog(null)}
        title={nameDialog?.kind === 'rename-folder' ? 'Rename folder' : 'New folder'}
        label="Folder name"
        placeholder="e.g. Midterm review"
        initialValue={nameDialog?.kind === 'rename-folder' ? nameDialog.folder.name : ''}
        submitLabel={nameDialog?.kind === 'rename-folder' ? 'Save' : 'Create folder'}
        onSubmit={async (name) => {
          if (nameDialog?.kind === 'rename-folder') await renameFolder(nameDialog.folder.id, name)
          else if (nameDialog?.kind === 'new-folder') await createFolder(name, nameDialog.subjectId)
        }}
      />
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean
  onClick: () => void
  color?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-fg hover:bg-surface-2',
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      {children}
    </button>
  )
}
