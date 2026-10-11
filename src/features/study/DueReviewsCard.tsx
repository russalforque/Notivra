import { useNavigate } from 'react-router'
import { Brain } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/misc'
import { useNow } from '../../hooks/useNow'
import { useStudySetSummaries } from './hooks'

export function DueReviewsCard() {
  const now = useNow()
  const summaries = useStudySetSummaries(now)
  const navigate = useNavigate()
  const due = (summaries ?? []).filter((s) => s.dueCount > 0)
  const total = due.reduce((n, s) => n + s.dueCount, 0)
  const top = due.sort((a, b) => b.dueCount - a.dueCount)[0]

  return (
    <Card className="flex flex-col justify-between gap-3 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Brain className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Reviews due</h2>
          <p className="text-sm text-muted">
            {summaries === undefined ? '…' : total === 0 ? 'You’re all caught up.' : `${total} card${total === 1 ? '' : 's'} across ${due.length} set${due.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>
      {top ? (
        <Button onClick={() => navigate(`/study/sets/${top.set.id}/flashcards`)}>Review “{top.set.title}”</Button>
      ) : (
        <Button variant="soft" onClick={() => navigate('/study')}>
          Browse study sets
        </Button>
      )}
    </Card>
  )
}
