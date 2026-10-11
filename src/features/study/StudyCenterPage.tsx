import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Brain, Clock, Layers, ListChecks, Plus, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/misc'
import { NameDialog } from '../../components/ui/NameDialog'
import { useNow } from '../../hooks/useNow'
import { formatRelative } from '../../lib/time'
import { useSubjects } from '../library/hooks'
import { useStudySetSummaries } from './hooks'
import { createStudySet } from './studyService'

export function StudyCenterPage() {
  const now = useNow()
  const summaries = useStudySetSummaries(now)
  const subjects = useSubjects() ?? []
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const subjectById = new Map(subjects.map((s) => [s.id, s]))
  const totalDue = (summaries ?? []).reduce((n, s) => n + s.dueCount, 0)

  return (
    <div>
      <PageHeader
        title="Study center"
        description="Flashcards with spaced repetition, quizzes and AI-made reviewers. Everything works offline once created."
        actions={
          <>
            <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => navigate('/study/generate')}>
              Generate with AI
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New study set
            </Button>
          </>
        }
      />

      {totalDue > 0 && (
        <Card className="mb-6 flex flex-wrap items-center gap-4 bg-primary-soft p-5">
          <Brain className="size-8 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {totalDue} card{totalDue === 1 ? '' : 's'} due for review
            </p>
            <p className="text-sm text-muted">Reviewing at the right time is the fastest way to remember for exams.</p>
          </div>
        </Card>
      )}

      {!summaries ? (
        <Spinner />
      ) : summaries.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No study sets yet"
          description="Create flashcards and quizzes yourself, or let AI draft them from your notes and PDFs."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New study set
              </Button>
              <Button variant="secondary" icon={<Sparkles className="size-4" />} onClick={() => navigate('/study/generate')}>
                Generate with AI
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map(({ set, itemCount, dueCount, lastStudiedAt }) => {
            const subject = set.subjectId ? subjectById.get(set.subjectId) : undefined
            return (
              <li key={set.id}>
                <Card className="flex h-full flex-col p-4">
                  <Link to={`/study/sets/${set.id}`} className="group flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold group-hover:text-primary">{set.title}</h2>
                      {set.origin === 'ai' && (
                        <Badge tone="primary">
                          <Sparkles className="size-3" /> AI
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      {subject && (
                        <span className="flex items-center gap-1">
                          <span className="size-2 rounded-full" style={{ backgroundColor: subject.color }} aria-hidden />
                          {subject.name}
                        </span>
                      )}
                      <span>{itemCount} items</span>
                      {lastStudiedAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" /> {formatRelative(lastStudiedAt, now)}
                        </span>
                      )}
                    </p>
                    {set.description && <p className="mt-2 line-clamp-2 text-sm text-muted">{set.description}</p>}
                  </Link>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="soft" icon={<Layers className="size-4" />} disabled={itemCount === 0} onClick={() => navigate(`/study/sets/${set.id}/flashcards`)}>
                      Review{dueCount > 0 ? ` (${dueCount})` : ''}
                    </Button>
                    <Button size="sm" variant="secondary" icon={<ListChecks className="size-4" />} disabled={itemCount === 0} onClick={() => navigate(`/study/sets/${set.id}/quiz`)}>
                      Quiz
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <NameDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New study set"
        label="Title"
        placeholder="e.g. Chapter 3 — Cell structure"
        submitLabel="Create"
        onSubmit={async (title) => {
          const set = await createStudySet({ title })
          navigate(`/study/sets/${set.id}`)
        }}
      />
    </div>
  )
}
