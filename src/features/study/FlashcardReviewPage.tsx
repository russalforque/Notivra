import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, EmptyState, ProgressBar, Spinner } from '../../components/ui/misc'
import type { ReviewGrade, StudyItem } from '../../db/types'
import { cn } from '../../lib/cn'
import { useStudySet } from './hooks'
import { SessionResult } from './SessionResult'
import { isDue, previewInterval } from './srs'
import { listItems } from './studyService'
import { useStudySession } from './useStudySession'

const GRADES: { grade: ReviewGrade; label: string; key: string; className: string }[] = [
  { grade: 'again', label: 'Again', key: '1', className: 'border-danger/40 text-danger hover:bg-danger-soft' },
  { grade: 'hard', label: 'Hard', key: '2', className: 'border-warning/40 text-warning hover:bg-warning-soft' },
  { grade: 'good', label: 'Good', key: '3', className: 'border-success/40 text-success hover:bg-success-soft' },
  { grade: 'easy', label: 'Easy', key: '4', className: 'border-primary/40 text-primary hover:bg-primary-soft' },
]

export function FlashcardReviewPage() {
  const { setId = '' } = useParams()
  const set = useStudySet(setId)
  const [items, setItems] = useState<StudyItem[] | null>(null)
  const [dueDeck, setDueDeck] = useState<StudyItem[]>([])
  const [mode, setMode] = useState<'due' | 'all' | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    // A snapshot: the deck must not reshuffle under the student while grading updates items.
    void listItems(setId).then((list) => {
      const now = Date.now()
      const due = list.filter((i) => isDue(i.srs, now)).sort((a, b) => a.srs.dueAt - b.srs.dueAt)
      setItems(list)
      setDueDeck(due)
      setMode(due.length > 0 ? 'due' : null)
    })
  }, [setId, round])

  if (!items || set === undefined) return <Spinner />
  if (items.length === 0) {
    return <EmptyState icon={<RotateCcw />} title="No cards yet" description="Add items to this set first." action={<Link to={`/study/sets/${setId}`} className="font-medium text-primary hover:underline">Back to set</Link>} />
  }
  if (!mode) {
    return (
      <EmptyState
        icon={<RotateCcw />}
        title="All caught up!"
        description="No cards are due right now. Practising early won’t hurt — it just doesn’t change your schedule much."
        action={<Button onClick={() => setMode('all')}>Practise all {items.length} cards</Button>}
      />
    )
  }
  const deck = mode === 'due' ? dueDeck : items
  return <Review key={`${round}-${mode}`} setId={setId} title={set?.title ?? 'Flashcards'} deck={deck} onRestart={() => setRound((r) => r + 1)} />
}

function Review({ setId, title, deck, onRestart }: { setId: string; title: string; deck: StudyItem[]; onRestart: () => void }) {
  const [queue, setQueue] = useState(deck)
  const [revealed, setRevealed] = useState(false)
  const [reviewed, setReviewed] = useState(new Set<string>())
  const { answer, finish, result } = useStudySession(setId, 'flashcards', deck.length)
  const card = queue[0]

  const grade = async (g: ReviewGrade) => {
    if (!card) return
    const rest = queue.slice(1)
    // "Again" shows the card once more at the end of this session.
    const nextQueue = g === 'again' && !reviewed.has(`again:${card.id}`) ? [...rest, card] : rest
    setReviewed((r) => new Set(r).add(card.id).add(g === 'again' ? `again:${card.id}` : card.id))
    setQueue(nextQueue)
    setRevealed(false)
    await answer({ itemId: card.id, correct: g !== 'again', grade: g, response: null })
    if (nextQueue.length === 0) await finish()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea')) return
      // Space/Enter on a focused button already activates it natively.
      if (!revealed && (e.key === ' ' || e.key === 'Enter') && !target.closest('button')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed) {
        const g = GRADES.find((x) => x.key === e.key)
        if (g) void grade(g.grade)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (result) {
    const again = result.session.answers.filter((a) => a.grade === 'again').length
    return (
      <SessionResult
        title="Session complete"
        detail={`You reviewed ${result.session.answers.length} card${result.session.answers.length === 1 ? '' : 's'}${again ? ` · ${again} to revisit soon` : ''}.`}
        xp={result.xp}
        setId={setId}
        onRestart={onRestart}
      />
    )
  }
  if (!card) return <Spinner label="Saving session" />

  const done = deck.length - new Set(queue.map((c) => c.id)).size
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link to={`/study/sets/${setId}`} className="flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {title}
        </Link>
        <span className="ml-auto text-sm text-muted tabular-nums">
          {done} / {deck.length}
        </span>
      </div>
      <ProgressBar value={done} max={deck.length} label="Session progress" />

      <Card
        key={`${card.id}-${revealed}`}
        className="animate-card-in flex min-h-72 cursor-pointer flex-col items-center justify-center gap-4 p-8 text-center"
        onClick={() => setRevealed(true)}
        role="region"
        aria-live="polite"
        aria-label={revealed ? 'Answer' : 'Question'}
      >
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{revealed ? 'Answer' : 'Question'}</p>
        <p className="text-xl font-semibold break-words whitespace-pre-wrap">{card.prompt}</p>
        {revealed && (
          <>
            <div className="h-px w-16 bg-border" />
            <p className="text-lg break-words whitespace-pre-wrap text-primary">{card.kind === 'true_false' ? (card.answer === 'true' ? 'True' : 'False') : card.answer}</p>
            {card.explanation && <p className="max-w-lg text-sm text-muted">{card.explanation}</p>}
          </>
        )}
      </Card>

      {!revealed ? (
        <Button size="lg" onClick={() => setRevealed(true)}>
          Show answer <kbd className="ml-2 hidden rounded bg-white/20 px-1.5 text-xs sm:inline">Space</kbd>
        </Button>
      ) : (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you remember?">
          {GRADES.map((g) => (
            <button
              key={g.grade}
              type="button"
              onClick={() => void grade(g.grade)}
              className={cn('flex flex-col items-center gap-0.5 rounded-xl border bg-surface py-3 text-sm font-semibold transition-colors', g.className)}
            >
              {g.label}
              <span className="text-xs font-normal text-muted">
                {previewInterval(card.srs, g.grade)} <span className="hidden sm:inline">· {g.key}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
