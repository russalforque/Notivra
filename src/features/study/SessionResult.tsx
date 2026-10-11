import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { PartyPopper, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/misc'

export function SessionResult({ title, detail, xp, setId, onRestart, children }: { title: string; detail: string; xp: number; setId: string; onRestart: () => void; children?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <Card className="mx-auto mt-6 flex max-w-xl flex-col items-center gap-4 p-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <PartyPopper className="size-8" aria-hidden />
      </span>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-muted">{detail}</p>
      </div>
      {xp > 0 ? (
        <p className="flex items-center gap-2 rounded-full bg-warning-soft px-4 py-1.5 text-sm font-semibold text-warning" role="status">
          <Sparkles className="size-4" /> +{xp} XP
        </p>
      ) : (
        <p className="text-xs text-muted">Sessions with at least 5 cards (or 3 quiz questions) earn XP.</p>
      )}
      {children}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => navigate(`/study/sets/${setId}`)}>
          Back to set
        </Button>
        <Button onClick={onRestart}>Study again</Button>
      </div>
    </Card>
  )
}
