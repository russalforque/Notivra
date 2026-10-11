import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Input, Select, Textarea } from '../../components/ui/Field'
import type { StudyItem, StudyItemKind } from '../../db/types'
import { cn } from '../../lib/cn'
import { toUserMessage } from '../../lib/errors'
import type { StudyItemInput } from './studyService'

interface Props {
  open: boolean
  item?: StudyItem | null
  onClose: () => void
  onSave: (input: StudyItemInput) => Promise<void>
}

export function ItemEditorDialog({ open, item, onClose, onSave }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={item ? 'Edit item' : 'Add item'} size="lg">
      {open && <ItemForm key={item?.id ?? 'new'} item={item ?? null} onClose={onClose} onSave={onSave} />}
    </Dialog>
  )
}

function ItemForm({ item, onClose, onSave }: { item: StudyItem | null; onClose: () => void; onSave: Props['onSave'] }) {
  const [kind, setKind] = useState<StudyItemKind>(item?.kind ?? 'flashcard')
  const [prompt, setPrompt] = useState(item?.prompt ?? '')
  const [answer, setAnswer] = useState(item?.answer ?? '')
  const [choices, setChoices] = useState<string[]>(item?.choices.length ? item.choices : ['', '', '', ''])
  const [correctIndex, setCorrectIndex] = useState(() => Math.max(0, item?.choices.indexOf(item.answer) ?? 0))
  const [accepted, setAccepted] = useState((item?.acceptedAnswers ?? []).join(', '))
  const [explanation, setExplanation] = useState(item?.explanation ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [keepOpen, setKeepOpen] = useState(false)

  const reset = () => {
    setPrompt('')
    setAnswer('')
    setChoices(['', '', '', ''])
    setCorrectIndex(0)
    setAccepted('')
    setExplanation('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const filledChoices = choices.map((c) => c.trim()).filter(Boolean)
      const input: StudyItemInput =
        kind === 'multiple_choice'
          ? { kind, prompt, answer: choices[correctIndex]?.trim() ?? '', choices: filledChoices, explanation }
          : kind === 'true_false'
            ? { kind, prompt, answer: answer === 'false' ? 'false' : 'true', explanation }
            : kind === 'short_answer'
              ? { kind, prompt, answer, acceptedAnswers: accepted.split(',').map((s) => s.trim()).filter(Boolean), explanation }
              : { kind, prompt, answer, explanation }
      await onSave(input)
      if (keepOpen && !item) reset()
      else onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <Field label="Type">
        {(p) => (
          <Select
            {...p}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as StudyItemKind
              setKind(k)
              if (k === 'true_false' && answer !== 'true' && answer !== 'false') setAnswer('true')
            }}
          >
            <option value="flashcard">Flashcard</option>
            <option value="multiple_choice">Multiple choice</option>
            <option value="true_false">True / false</option>
            <option value="short_answer">Short answer</option>
          </Select>
        )}
      </Field>
      <Field label={kind === 'flashcard' ? 'Front' : kind === 'true_false' ? 'Statement' : 'Question'}>
        {(p) => <Textarea {...p} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus />}
      </Field>

      {(kind === 'flashcard' || kind === 'short_answer') && (
        <Field label={kind === 'flashcard' ? 'Back' : 'Correct answer'}>
          {(p) => <Textarea {...p} rows={kind === 'flashcard' ? 3 : 1} value={answer} onChange={(e) => setAnswer(e.target.value)} />}
        </Field>
      )}
      {kind === 'short_answer' && (
        <Field label="Also accept (optional)" hint="Comma-separated alternatives, e.g. “DNA, deoxyribonucleic acid”. Small typos are accepted automatically.">
          {(p) => <Input {...p} value={accepted} onChange={(e) => setAccepted(e.target.value)} />}
        </Field>
      )}
      {kind === 'true_false' && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Correct answer</legend>
          <div className="flex gap-2">
            {['true', 'false'].map((v) => (
              <label key={v} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm', answer === v ? 'border-primary bg-primary-soft text-primary' : 'border-border')}>
                <input type="radio" name="tf" className="sr-only" checked={answer === v} onChange={() => setAnswer(v)} />
                {v === 'true' ? 'True' : 'False'}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {kind === 'multiple_choice' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">Options (select the correct one)</legend>
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name="correct" aria-label={`Option ${i + 1} is correct`} checked={correctIndex === i} onChange={() => setCorrectIndex(i)} className="size-4 accent-[var(--primary)]" />
              <Input value={c} aria-label={`Option ${i + 1}`} onChange={(e) => setChoices(choices.map((x, k) => (k === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
              {choices.length > 2 && (
                <IconButton
                  label={`Remove option ${i + 1}`}
                  size="sm"
                  onClick={() => {
                    setChoices(choices.filter((_, k) => k !== i))
                    if (i < correctIndex) setCorrectIndex(correctIndex - 1)
                    else if (i === correctIndex) setCorrectIndex(0)
                  }}
                >
                  <X className="size-4" />
                </IconButton>
              )}
            </div>
          ))}
          {choices.length < 6 && (
            <Button variant="ghost" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={() => setChoices([...choices, ''])}>
              Add option
            </Button>
          )}
        </fieldset>
      )}

      <Field label="Explanation (optional)" hint="Shown after answering — great for remembering why.">
        {(p) => <Textarea {...p} rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />}
      </Field>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!item ? (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Add another after saving
          </label>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {item ? 'Save' : 'Add item'}
          </Button>
        </div>
      </div>
    </form>
  )
}
