import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowLeft, BookOpen, ClipboardPaste, FileText, Loader2, ShieldCheck, Sparkles, Trash2, WifiOff } from 'lucide-react'
import { Markdown } from '../../components/Markdown'
import { Button, IconButton } from '../../components/ui/Button'
import { Field, Input, Select, Textarea } from '../../components/ui/Field'
import { Badge, Card, PageHeader } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import { db } from '../../db/database'
import type { StudySource } from '../../db/types'
import { useOnline } from '../../hooks/useOnline'
import { cn } from '../../lib/cn'
import { toUserMessage } from '../../lib/errors'
import { MAX_AI_INPUT_CHARS, MIN_AI_INPUT_CHARS, type AiOutputKind, type AiResponse } from '../../services/ai/aiContract'
import { AiError, getAiProvider } from '../../services/ai/aiService'
import { setSetting } from '../../services/settings'
import { isCloudConfigured } from '../../services/supabase/client'
import { useDocuments, useNotebooks, useSubjects } from '../library/hooks'
import { listPages } from '../notebook/pageService'
import { loadDocumentBytes } from '../pdf/documentService'
import { onStudySetChanged } from '../progress/xpTriggers'
import { aiResponseToItems, combineNotes } from './aiResult'
import { createStudySetWithItems } from './studyService'

type SourceKind = 'notebook' | 'document' | 'text'

const OUTPUTS: { id: AiOutputKind; label: string; hint: string }[] = [
  { id: 'reviewer', label: 'Exam reviewer', hint: 'Key concepts, definitions and likely questions' },
  { id: 'summary', label: 'Summary', hint: 'Short structured overview' },
  { id: 'flashcards', label: 'Flashcards', hint: 'For spaced-repetition review' },
  { id: 'quiz', label: 'Quiz', hint: 'Multiple choice, true/false and short answer' },
]

export function AiGeneratorPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const online = useOnline()
  const notebooks = useNotebooks() ?? []
  const documents = useDocuments() ?? []
  const subjects = useSubjects() ?? []
  const consentAt = useLiveQuery(async () => ((await db.settings.get('aiConsentAt'))?.value as number | null) ?? null, [])

  const [kind, setKind] = useState<SourceKind>(params.get('document') ? 'document' : params.get('notebook') ? 'notebook' : 'text')
  const [notebookId, setNotebookId] = useState(params.get('notebook') ?? '')
  const [documentId, setDocumentId] = useState(params.get('document') ?? '')
  const [fromPage, setFromPage] = useState(1)
  const [toPage, setToPage] = useState(10)
  const [pasted, setPasted] = useState('')
  const [outputs, setOutputs] = useState<AiOutputKind[]>(['reviewer', 'flashcards', 'quiz'])
  const [flashcardCount, setFlashcardCount] = useState(15)
  const [quizCount, setQuizCount] = useState(10)
  const [consent, setConsent] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'generating'>('idle')
  const [error, setError] = useState<AiError | null>(null)
  const [result, setResult] = useState<(AiResponse & { source: StudySource }) | null>(null)
  const abort = useRef<AbortController | null>(null)

  const selectedDoc = documents.find((d) => d.id === documentId)
  // Derived, not stored: the range always fits the selected document.
  const firstPage = selectedDoc ? clamp(fromPage, 1, selectedDoc.pageCount) : fromPage
  const lastPage = selectedDoc ? clamp(toPage, firstPage, selectedDoc.pageCount) : toPage

  const consentGiven = consent || !!consentAt

  /** Collects source text locally. Nothing leaves the device until the user presses Generate. */
  const collectText = async (): Promise<{ text: string; source: StudySource }> => {
    if (kind === 'text') return { text: pasted, source: { type: 'text', refId: null, label: 'Pasted text' } }
    if (kind === 'notebook') {
      const nb = notebooks.find((n) => n.id === notebookId)
      if (!nb) throw new Error('Choose a notebook.')
      const pages = await listPages(nb.id)
      const text = pages
        .map((p, i) => (p.plainText.trim() ? `[Page ${i + 1}]\n${p.plainText}` : ''))
        .filter(Boolean)
        .join('\n\n')
      return { text, source: { type: 'notebook', refId: nb.id, label: nb.title } }
    }
    if (!selectedDoc) throw new Error('Choose a PDF.')
    const { extractText } = await import('../pdf/pdfjs')
    const { text } = await extractText(await loadDocumentBytes(selectedDoc), firstPage, lastPage, MAX_AI_INPUT_CHARS)
    return { text, source: { type: 'document', refId: selectedDoc.id, label: `${selectedDoc.title} (pages ${firstPage}–${lastPage})` } }
  }

  const generate = async () => {
    setError(null)
    setResult(null)
    try {
      setPhase('extracting')
      const { text, source } = await collectText()
      if (text.trim().length < MIN_AI_INPUT_CHARS) {
        throw new AiError(
          'invalid_request',
          kind === 'notebook'
            ? 'This notebook has too little typed text. AI can only read typed text boxes, not handwriting.'
            : kind === 'document'
              ? 'These pages contain little or no selectable text (scanned PDFs are not supported yet).'
              : 'Please paste at least 200 characters.',
        )
      }
      if (!consentAt) await setSetting('aiConsentAt', Date.now())
      setPhase('generating')
      abort.current = new AbortController()
      const response = await getAiProvider().generate(
        { outputs, text: text.slice(0, MAX_AI_INPUT_CHARS), sourceLabel: source.label, flashcardCount, quizCount },
        abort.current.signal,
      )
      setResult({ ...response, source })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      setError(err instanceof AiError ? err : new AiError('invalid_request', toUserMessage(err, (err as Error)?.message || 'Generation failed.')))
    } finally {
      setPhase('idle')
      abort.current = null
    }
  }

  if (result) {
    return <ResultEditor initial={result} subjects={subjects} onDiscard={() => setResult(null)} onSaved={(id) => navigate(`/study/sets/${id}`)} />
  }

  const busy = phase !== 'idle'
  const blocked = !isCloudConfigured

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/study" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Study center
      </Link>
      <PageHeader title="Generate with AI" description="Turn your notes or a PDF into a reviewer, flashcards and a quiz. You can edit everything before saving." />

      {blocked && (
        <Card className="mb-5 flex items-start gap-3 border-warning/40 bg-warning-soft p-4 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p>
            AI tools need the Notivra cloud service, which isn’t configured in this build. You can still{' '}
            <Link to="/study" className="font-semibold underline">
              create study sets manually
            </Link>
            .
          </p>
        </Card>
      )}
      {!online && !blocked && (
        <Card className="mb-5 flex items-start gap-3 p-4 text-sm">
          <WifiOff className="mt-0.5 size-5 shrink-0 text-muted" />
          <p className="text-muted">You’re offline. AI generation needs internet; saved study sets work offline as usual.</p>
        </Card>
      )}

      <div className="flex flex-col gap-5">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">1. Source</h2>
          <div role="tablist" aria-label="Source type" className="mb-4 grid grid-cols-3 gap-2">
            {(
              [
                ['notebook', 'Notebook', BookOpen],
                ['document', 'PDF', FileText],
                ['text', 'Paste text', ClipboardPaste],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={kind === id}
                onClick={() => setKind(id)}
                className={cn('flex flex-col items-center gap-1 rounded-xl border py-3 text-sm font-medium', kind === id ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-surface-2')}
              >
                <Icon className="size-5" /> {label}
              </button>
            ))}
          </div>
          {kind === 'notebook' && (
            <Field label="Notebook" hint="Typed text boxes are used. Handwriting is not read yet.">
              {(p) => (
                <Select {...p} value={notebookId} onChange={(e) => setNotebookId(e.target.value)}>
                  <option value="">Choose a notebook…</option>
                  {notebooks.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {kind === 'document' && (
            <div className="flex flex-col gap-3">
              <Field label="PDF">
                {(p) => (
                  <Select {...p} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
                    <option value="">Choose a PDF…</option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.pageCount} pages)
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {selectedDoc && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From page">{(p) => <Input {...p} type="number" min={1} max={selectedDoc.pageCount} value={firstPage} onChange={(e) => setFromPage(clamp(+e.target.value, 1, selectedDoc.pageCount))} />}</Field>
                  <Field label="To page">{(p) => <Input {...p} type="number" min={firstPage} max={selectedDoc.pageCount} value={lastPage} onChange={(e) => setToPage(clamp(+e.target.value, firstPage, selectedDoc.pageCount))} />}</Field>
                </div>
              )}
            </div>
          )}
          {kind === 'text' && (
            <Field label="Text" hint={`${pasted.length.toLocaleString()} / ${MAX_AI_INPUT_CHARS.toLocaleString()} characters`}>
              {(p) => <Textarea {...p} rows={8} value={pasted} maxLength={MAX_AI_INPUT_CHARS} onChange={(e) => setPasted(e.target.value)} placeholder="Paste lecture notes, a chapter, or an article…" />}
            </Field>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">2. What to create</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {OUTPUTS.map((o) => (
              <label key={o.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', outputs.includes(o.id) ? 'border-primary bg-primary-soft' : 'border-border')}>
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={outputs.includes(o.id)}
                  onChange={(e) => setOutputs(e.target.checked ? [...outputs, o.id] : outputs.filter((x) => x !== o.id))}
                />
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {outputs.includes('flashcards') && (
              <Field label={`Flashcards: up to ${flashcardCount}`}>{(p) => <input {...p} type="range" min={5} max={40} step={5} value={flashcardCount} onChange={(e) => setFlashcardCount(+e.target.value)} className="accent-[var(--primary)]" />}</Field>
            )}
            {outputs.includes('quiz') && (
              <Field label={`Quiz questions: up to ${quizCount}`}>{(p) => <input {...p} type="range" min={5} max={30} step={5} value={quizCount} onChange={(e) => setQuizCount(+e.target.value)} className="accent-[var(--primary)]" />}</Field>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">3. Privacy</h2>
          <div className="flex items-start gap-3 text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
            <div className="flex flex-col gap-2">
              <p className="text-muted">
                The text you selected is sent to Notivra’s AI service, which uses a third-party AI provider (Anthropic) to generate your materials. The text
                isn’t stored by Notivra after generation. Avoid sending documents with sensitive personal information.
              </p>
              {consentAt ? (
                <p className="text-xs text-muted">You agreed to this on {new Date(consentAt).toLocaleDateString()}.</p>
              ) : (
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I understand and want to continue
                </label>
              )}
            </div>
          </div>
        </Card>

        {error && (
          <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p className="min-w-0 flex-1">{error.message}</p>
            {error.code === 'signed_out' && (
              <Link to="/settings#sync" className="font-semibold underline">
                Sign in
              </Link>
            )}
            {error.retryable && (
              <Button size="sm" variant="danger" onClick={() => void generate()}>
                Try again
              </Button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {phase === 'generating' && (
            <Button variant="secondary" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          )}
          <Button size="lg" icon={busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} disabled={busy || blocked || !consentGiven || outputs.length === 0 || !online} onClick={() => void generate()}>
            {phase === 'extracting' ? 'Reading source…' : phase === 'generating' ? 'Generating… (up to a minute)' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function clamp(n: number, min: number, max: number) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min
}

function ResultEditor({
  initial,
  subjects,
  onDiscard,
  onSaved,
}: {
  initial: AiResponse & { source: StudySource }
  subjects: { id: string; name: string }[]
  onDiscard: () => void
  onSaved: (setId: string) => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [notes, setNotes] = useState(combineNotes(initial) ?? '')
  const [editingNotes, setEditingNotes] = useState(false)
  const [flashcards, setFlashcards] = useState(initial.flashcards)
  const [quiz, setQuiz] = useState(initial.quiz)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const { items, rejected } = aiResponseToItems({ flashcards, quiz })
      const set = await createStudySetWithItems(
        { title, subjectId, description: `Generated from ${initial.source.label}.`, summary: notes.trim() || null, origin: 'ai', source: initial.source },
        items,
      )
      void onStudySetChanged(set.id)
      if (rejected > 0) toast.warning(`${rejected} item${rejected === 1 ? ' was' : 's were'} skipped because they were incomplete.`)
      toast.success('Study set saved — it’s available offline now.')
      onSaved(set.id)
    } catch (err) {
      toast.error(toUserMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Review before saving"
        description="AI can make mistakes. Check the content, remove anything wrong, then save."
        actions={
          <>
            <Button variant="secondary" onClick={onDiscard}>
              Discard
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save study set
            </Button>
          </>
        }
      />
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Title">{(p) => <Input {...p} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Subject">
          {(p) => (
            <Select {...p} value={subjectId ?? ''} onChange={(e) => setSubjectId(e.target.value || null)}>
              <option value="">No subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-xs text-muted sm:col-span-2">Source: {initial.source.label}</p>
      </Card>

      {notes && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Reviewer & summary</h2>
            <Button size="sm" variant="ghost" onClick={() => setEditingNotes((e) => !e)}>
              {editingNotes ? 'Preview' : 'Edit'}
            </Button>
          </div>
          {editingNotes ? <Textarea rows={16} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Reviewer text" className="font-mono text-xs" /> : <Markdown source={notes} />}
        </Card>
      )}

      {flashcards.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Flashcards ({flashcards.length})</h2>
          <ul className="flex flex-col gap-2">
            {flashcards.map((f, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl border border-border p-3">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <Textarea aria-label={`Card ${i + 1} front`} rows={2} value={f.front} onChange={(e) => setFlashcards(flashcards.map((x, k) => (k === i ? { ...x, front: e.target.value } : x)))} />
                  <Textarea aria-label={`Card ${i + 1} back`} rows={2} value={f.back} onChange={(e) => setFlashcards(flashcards.map((x, k) => (k === i ? { ...x, back: e.target.value } : x)))} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <IconButton label={`Remove card ${i + 1}`} size="sm" onClick={() => setFlashcards(flashcards.filter((_, k) => k !== i))}>
                    <Trash2 className="size-4" />
                  </IconButton>
                  {f.sourceRef && <Badge tone="primary">{f.sourceRef}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {quiz.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Quiz ({quiz.length})</h2>
          <ol className="flex flex-col gap-2">
            {quiz.map((q, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Textarea aria-label={`Question ${i + 1}`} rows={2} value={q.question} onChange={(e) => setQuiz(quiz.map((x, k) => (k === i ? { ...x, question: e.target.value } : x)))} />
                  {q.type === 'multiple_choice' && (
                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                      {q.choices.map((c) => (
                        <li key={c} className={cn('rounded-lg px-2 py-1', c === q.answer ? 'bg-success-soft font-medium text-success' : 'bg-surface-2')}>
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.type !== 'multiple_choice' && <p className="mt-2 text-success">Answer: {q.answer}</p>}
                  {q.explanation && <p className="mt-1 text-muted">{q.explanation}</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <IconButton label={`Remove question ${i + 1}`} size="sm" onClick={() => setQuiz(quiz.filter((_, k) => k !== i))}>
                    <Trash2 className="size-4" />
                  </IconButton>
                  <Badge>{q.type.replace('_', ' ')}</Badge>
                  {q.sourceRef && <Badge tone="primary">{q.sourceRef}</Badge>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}
