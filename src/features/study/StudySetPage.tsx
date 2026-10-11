import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Layers, ListChecks, MoreVertical, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Markdown } from '../../components/Markdown'
import { Button, IconButton } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Select, Textarea } from '../../components/ui/Field'
import { Menu } from '../../components/ui/Menu'
import { NameDialog } from '../../components/ui/NameDialog'
import { Badge, Card, EmptyState, Spinner } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import type { StudyItem } from '../../db/types'
import { useNow } from '../../hooks/useNow'
import { toUserMessage } from '../../lib/errors'
import { formatRelative } from '../../lib/time'
import { useSubjects } from '../library/hooks'
import { onStudySetChanged } from '../progress/xpTriggers'
import { useSessions, useStudyItems, useStudySet } from './hooks'
import { ItemEditorDialog } from './ItemEditor'
import { isDue } from './srs'
import { addItem, deleteItem, deleteStudySet, itemKindLabel, updateItem, updateStudySet } from './studyService'

export function StudySetPage() {
  const { setId } = useParams()
  const set = useStudySet(setId)
  const items = useStudyItems(setId)
  const sessions = useSessions(setId)
  const subjects = useSubjects() ?? []
  const navigate = useNavigate()
  const confirm = useConfirm()
  const now = useNow()
  const [editing, setEditing] = useState<{ open: boolean; item: StudyItem | null }>({ open: false, item: null })
  const [renaming, setRenaming] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)

  if (set === undefined || items === undefined) return <Spinner />
  if (!set || set.deletedAt !== null) {
    return (
      <EmptyState
        icon={<Layers />}
        title="Study set not found"
        description="It may have been deleted."
        action={
          <Link to="/study" className="font-medium text-primary hover:underline">
            Back to study center
          </Link>
        }
      />
    )
  }

  const due = items.filter((i) => isDue(i.srs, now)).length
  const subject = subjects.find((s) => s.id === set.subjectId)

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete “${set.title}”?`,
      message: 'All items and review progress in this set will be deleted.',
      confirmLabel: 'Delete set',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteStudySet(set.id)
      navigate('/study')
      toast.info('Study set deleted.')
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/study" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Study center
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
              {set.title}
              {set.origin === 'ai' && (
                <Badge tone="primary">
                  <Sparkles className="size-3" /> AI-generated
                </Badge>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {subject ? `${subject.name} · ` : ''}
              {items.length} items · {due} due
              {set.source && ` · from ${set.source.label}`}
            </p>
            {set.description && <p className="mt-2 max-w-2xl text-sm">{set.description}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Layers className="size-4" />} disabled={items.length === 0} onClick={() => navigate(`/study/sets/${set.id}/flashcards`)}>
              {due > 0 ? `Review ${due} due` : 'Practice cards'}
            </Button>
            <Button variant="secondary" icon={<ListChecks className="size-4" />} disabled={items.length === 0} onClick={() => navigate(`/study/sets/${set.id}/quiz`)}>
              Take quiz
            </Button>
            <Menu
              items={[
                { label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(true) },
                { label: 'Edit details', icon: <Pencil />, onSelect: () => setEditingDetails(true) },
                'separator',
                { label: 'Delete set', icon: <Trash2 />, danger: true, onSelect: () => void onDelete() },
              ]}
              trigger={(p) => (
                <IconButton {...p} label="Set options" variant="secondary">
                  <MoreVertical className="size-5" />
                </IconButton>
              )}
            />
          </div>
        </div>
      </div>

      {set.summary && (
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">Reviewer</h2>
          <Markdown source={set.summary} />
        </Card>
      )}

      <section aria-labelledby="items-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="items-heading" className="text-lg font-semibold">
            Items
          </h2>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({ open: true, item: null })}>
            Add item
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState icon={<Plus />} title="No items yet" description="Add flashcards or questions to start studying." />
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {items.map((item, i) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 w-6 shrink-0 text-right text-sm text-muted tabular-nums">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words whitespace-pre-wrap">{item.prompt}</p>
                  <p className="mt-0.5 text-sm break-words text-muted">
                    {item.kind === 'true_false' ? (item.answer === 'true' ? 'True' : 'False') : item.answer}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge>{itemKindLabel(item.kind)}</Badge>
                    {item.srs.reps > 0 && <Badge tone={isDue(item.srs, now) ? 'warning' : 'success'}>{isDue(item.srs, now) ? 'Due' : `Next ${formatRelative(item.srs.dueAt, now)}`}</Badge>}
                    {item.sourceRef && <Badge tone="primary">{item.sourceRef}</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton label="Edit item" size="sm" onClick={() => setEditing({ open: true, item })}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Delete item"
                    size="sm"
                    className="text-danger"
                    onClick={async () => {
                      try {
                        await deleteItem(item.id)
                        toast.info('Item deleted.')
                      } catch (err) {
                        toast.error(toUserMessage(err))
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {sessions && sessions.length > 0 && (
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="mb-3 text-lg font-semibold">
            Recent sessions
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface text-sm">
            {sessions.slice(0, 10).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span>{s.mode === 'quiz' ? 'Quiz' : 'Flashcards'}</span>
                <span className="text-muted">{formatRelative(s.completedAt!, now)}</span>
                <span className="font-medium tabular-nums">
                  {s.mode === 'quiz' ? `${s.correctCount}/${s.totalCount}` : `${s.answers.length} reviewed`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ItemEditorDialog
        open={editing.open}
        item={editing.item}
        onClose={() => setEditing({ open: false, item: null })}
        onSave={async (input) => {
          if (editing.item) await updateItem(editing.item.id, input)
          else {
            await addItem(set.id, input)
            void onStudySetChanged(set.id)
          }
        }}
      />
      <NameDialog open={renaming} onClose={() => setRenaming(false)} title="Rename study set" label="Title" initialValue={set.title} onSubmit={(title) => updateStudySet(set.id, { title })} />
      <DetailsDialog
        open={editingDetails}
        onClose={() => setEditingDetails(false)}
        description={set.description}
        subjectId={set.subjectId}
        subjects={subjects}
        onSave={(patch) => updateStudySet(set.id, patch)}
      />
    </div>
  )
}

function DetailsDialog({
  open,
  onClose,
  description,
  subjectId,
  subjects,
  onSave,
}: {
  open: boolean
  onClose: () => void
  description: string
  subjectId: string | null
  subjects: { id: string; name: string }[]
  onSave: (patch: { description: string; subjectId: string | null }) => Promise<void>
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Set details">
      {open && <DetailsForm description={description} subjectId={subjectId} subjects={subjects} onSave={onSave} onClose={onClose} />}
    </Dialog>
  )
}

function DetailsForm({
  description,
  subjectId,
  subjects,
  onSave,
  onClose,
}: {
  description: string
  subjectId: string | null
  subjects: { id: string; name: string }[]
  onSave: (patch: { description: string; subjectId: string | null }) => Promise<void>
  onClose: () => void
}) {
  const [desc, setDesc] = useState(description)
  const [subject, setSubject] = useState(subjectId)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await onSave({ description: desc.trim(), subjectId: subject })
          onClose()
        } catch (err) {
          toast.error(toUserMessage(err))
        }
      }}
    >
      <Field label="Subject">
        {(p) => (
          <Select {...p} value={subject ?? ''} onChange={(e) => setSubject(e.target.value || null)}>
            <option value="">No subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Description">{(p) => <Textarea {...p} rows={3} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  )
}
