import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, BookOpen, FileText, GraduationCap, Plus, ShieldAlert } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState } from '../../components/ui/misc'
import { db } from '../../db/database'
import { pickFiles } from '../../lib/filePicker'
import { DAY_MS, formatRelative } from '../../lib/time'
import { useNow } from '../../hooks/useNow'
import { useDocuments, useNotebooks, useSubjects } from '../library/hooks'
import { NotebookDialog } from '../library/NotebookDialog'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function HomePage() {
  const navigate = useNavigate()
  const notebooks = useNotebooks()
  const documents = useDocuments()
  const subjects = useSubjects() ?? []
  const [creating, setCreating] = useState(false)
  const nowMs = useNow()
  const lastBackupAt = useLiveQuery(async () => ((await db.settings.get('lastBackupAt'))?.value as number | null) ?? null, [])

  const recentNotebooks = [...(notebooks ?? [])].sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt)).slice(0, 4)
  const recentDocs = [...(documents ?? [])].sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt)).slice(0, 4)
  const subjectById = new Map(subjects.map((s) => [s.id, s]))
  const hasContent = (notebooks?.length ?? 0) + (documents?.length ?? 0) > 0
  const needsBackup = hasContent && lastBackupAt !== undefined && (!lastBackupAt || nowMs - lastBackupAt > 7 * DAY_MS)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{greeting()} 👋</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<FileText className="size-4" />}
            onClick={async () => {
              // Open the picker inside the click (user activation), then load the PDF engine.
              const files = await pickFiles('application/pdf,.pdf', true)
              if (files.length === 0) return
              const { importPdfFiles } = await import('../pdf/importPdfs')
              const imported = await importPdfFiles(files)
              navigate(imported.length === 1 ? `/library/${imported[0]!.id}` : '/library')
            }}
          >
            Import PDF
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New notebook
          </Button>
        </div>
      </div>

      {needsBackup && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <ShieldAlert className="size-5 shrink-0" />
          <p className="min-w-0 flex-1">
            {lastBackupAt ? `Your last backup was ${formatRelative(lastBackupAt)}.` : "You haven't backed up yet."} Notes saved on this device are not a
            backup.
          </p>
          <Link to="/settings#backup" className="font-semibold underline-offset-2 hover:underline">
            Back up now
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <GraduationCap className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold">Study center</h2>
              <p className="text-sm text-muted">Flashcards, quizzes and AI reviewers.</p>
            </div>
          </div>
          <Button variant="soft" onClick={() => navigate('/study')}>
            Open study center
          </Button>
        </Card>
      </div>

      <section aria-labelledby="recent-notebooks">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-notebooks" className="text-lg font-semibold">
            Continue writing
          </h2>
          <Link to="/notebooks" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            All notebooks <ArrowRight className="size-4" />
          </Link>
        </div>
        {notebooks && recentNotebooks.length === 0 ? (
          <EmptyState
            icon={<BookOpen />}
            title="Start your first notebook"
            description="Write, draw and highlight — everything saves on this device instantly, even offline."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New notebook
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recentNotebooks.map((n) => {
              const subject = n.subjectId ? subjectById.get(n.subjectId) : undefined
              return (
                <li key={n.id}>
                  <Link
                    to={`/notebooks/${n.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-shadow hover:shadow-md"
                  >
                    <span className="h-12 w-9 shrink-0 rounded-md shadow-inner" style={{ backgroundColor: n.color }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{n.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {subject ? `${subject.name} · ` : ''}
                        {formatRelative(n.lastOpenedAt ?? n.updatedAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {recentDocs.length > 0 && (
        <section aria-labelledby="recent-docs">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-docs" className="text-lg font-semibold">
              Recent PDFs
            </h2>
            <Link to="/library" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              PDF library <ArrowRight className="size-4" />
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recentDocs.map((d) => (
              <li key={d.id}>
                <Link to={`/library/${d.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-shadow hover:shadow-md">
                  {d.thumbnail ? (
                    <img src={d.thumbnail} alt="" className="h-12 w-9 shrink-0 rounded-md border border-border object-cover" />
                  ) : (
                    <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                      <FileText className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{d.title}</span>
                    <span className="block text-xs text-muted">
                      {d.pageCount} pages · {formatRelative(d.lastOpenedAt ?? d.updatedAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NotebookDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
