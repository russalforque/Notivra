import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Check, ListChecks, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { Card, EmptyState, ProgressBar, Spinner } from '../../components/ui/misc'
import { cn } from '../../lib/cn'
import { useStudySet } from './hooks'
import { buildQuiz, checkAnswer, type QuizQuestion } from './quiz'
import { SessionResult } from './SessionResult'
import { listItems } from './studyService'
import { useStudySession } from './useStudySession'

export function QuizPage() {
  const { setId = '' } = useParams()
  const set = useStudySet(setId)
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    void listItems(setId).then((items) => setQuestions(buildQuiz(items)))
  }, [setId, round])

  if (!questions || set === undefined) return <Spinner />
  if (questions.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks />}
        title="No questions yet"
        description="Add items to this set to take a quiz."
        action={<Link to={`/study/sets/${setId}`} className="font-medium text-primary hover:underline">Back to set</Link>}
      />
    )
  }
  return <Quiz key={round} setId={setId} title={set?.title ?? 'Quiz'} questions={questions} onRestart={() => setRound((r) => r + 1)} />
}

interface Answered {
  question: QuizQuestion
  response: string
  correct: boolean
}

function Quiz({ setId, title, questions, onRestart }: { setId: string; title: string; questions: QuizQuestion[]; onRestart: () => void }) {
  const [index, setIndex] = useState(0)
  const [response, setResponse] = useState('')
  const [answered, setAnswered] = useState<Answered[]>([])
  const [revealed, setRevealed] = useState(false)
  const { answer, finish, result } = useStudySession(setId, 'quiz', questions.length)
  const q = questions[index]
  const current = answered[index]

  const submit = async (value: string) => {
    if (!q || current) return
    const correct = checkAnswer(q, value)
    setAnswered((a) => [...a, { question: q, response: value, correct }])
    await answer({ itemId: q.item.id, correct, grade: null, response: value })
  }

  const next = async () => {
    setResponse('')
    setRevealed(false)
    if (index + 1 < questions.length) setIndex(index + 1)
    else await finish()
  }

  if (result) {
    const correct = answered.filter((a) => a.correct).length
    const pct = Math.round((correct / questions.length) * 100)
    const missed = answered.filter((a) => !a.correct)
    return (
      <SessionResult title={`${pct}% correct`} detail={`${correct} of ${questions.length} questions right.`} xp={result.xp} setId={setId} onRestart={onRestart}>
        {missed.length > 0 && (
          <div className="w-full text-left">
            <h2 className="mb-2 text-sm font-semibold">Review what you missed</h2>
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {missed.map((m) => (
                <li key={m.question.item.id} className="px-3 py-2">
                  <p className="font-medium">{m.question.prompt}</p>
                  <p className="text-success">Answer: {displayAnswer(m.question)}</p>
                  {m.question.item.explanation && <p className="text-muted">{m.question.item.explanation}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SessionResult>
    )
  }
  if (!q) return <Spinner label="Saving results" />

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link to={`/study/sets/${setId}`} className="flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> {title}
        </Link>
        <span className="ml-auto text-sm text-muted tabular-nums">
          Question {index + 1} / {questions.length}
        </span>
      </div>
      <ProgressBar value={index + (current ? 1 : 0)} max={questions.length} label="Quiz progress" />

      <Card className="flex flex-col gap-5 p-6">
        <h1 className="text-xl font-semibold break-words whitespace-pre-wrap" id="question">
          {q.kind === 'true_false' && <span className="mb-1 block text-xs font-semibold tracking-wide text-muted uppercase">True or false?</span>}
          {q.prompt}
        </h1>

        {q.kind === 'multiple_choice' && (
          <div role="radiogroup" aria-labelledby="question" className="flex flex-col gap-2">
            {q.choices.map((c, i) => {
              const isAnswer = c === q.answer
              const isPicked = current?.response === c
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  disabled={!!current}
                  onClick={() => void submit(c)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                    !current && 'border-border hover:border-primary hover:bg-primary-soft',
                    current && isAnswer && 'border-success bg-success-soft text-success',
                    current && isPicked && !isAnswer && 'border-danger bg-danger-soft text-danger',
                    current && !isAnswer && !isPicked && 'border-border opacity-60',
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold">{String.fromCharCode(65 + i)}</span>
                  <span className="min-w-0 break-words">{c}</span>
                </button>
              )
            })}
          </div>
        )}

        {q.kind === 'true_false' && (
          <div className="grid grid-cols-2 gap-3">
            {(['true', 'false'] as const).map((v) => (
              <button
                key={v}
                type="button"
                disabled={!!current}
                onClick={() => void submit(v)}
                className={cn(
                  'rounded-xl border py-4 text-lg font-semibold transition-colors',
                  !current && 'border-border hover:border-primary hover:bg-primary-soft',
                  current && q.answer === v && 'border-success bg-success-soft text-success',
                  current && current.response === v && q.answer !== v && 'border-danger bg-danger-soft text-danger',
                  current && q.answer !== v && current.response !== v && 'border-border opacity-60',
                )}
              >
                {v === 'true' ? 'True' : 'False'}
              </button>
            ))}
          </div>
        )}

        {q.kind === 'short_answer' && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (response.trim()) void submit(response)
            }}
            className="flex gap-2"
          >
            <Input aria-label="Your answer" value={response} onChange={(e) => setResponse(e.target.value)} disabled={!!current} autoFocus placeholder="Type your answer" />
            {!current && (
              <Button type="submit" disabled={!response.trim()}>
                Check
              </Button>
            )}
          </form>
        )}

        {q.kind === 'self_check' &&
          (!revealed ? (
            <Button onClick={() => setRevealed(true)}>Show answer</Button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="rounded-xl bg-surface-2 px-4 py-3 text-lg break-words whitespace-pre-wrap">{q.answer}</p>
              {!current && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" icon={<X className="size-4" />} onClick={() => void submit('wrong')}>
                    I got it wrong
                  </Button>
                  <Button icon={<Check className="size-4" />} onClick={() => void submit('correct')}>
                    I got it right
                  </Button>
                </div>
              )}
            </div>
          ))}

        {current && (
          <div role="status" className={cn('rounded-xl px-4 py-3 text-sm', current.correct ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
            <p className="flex items-center gap-2 font-semibold">
              {current.correct ? <Check className="size-4" /> : <X className="size-4" />}
              {current.correct ? 'Correct!' : `Not quite. The answer is: ${displayAnswer(q)}`}
            </p>
            {q.item.explanation && <p className="mt-1 text-fg">{q.item.explanation}</p>}
          </div>
        )}
      </Card>

      {current && (
        <Button size="lg" autoFocus onClick={() => void next()}>
          {index + 1 < questions.length ? 'Next question' : 'See results'}
        </Button>
      )}
    </div>
  )
}

function displayAnswer(q: QuizQuestion): string {
  if (q.kind === 'true_false') return q.answer === 'true' ? 'True' : 'False'
  return q.answer
}
