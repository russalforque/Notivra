import { Link } from 'react-router'
import { Flame } from 'lucide-react'
import { Card, ProgressBar } from '../../components/ui/misc'
import { useProgressStats } from './hooks'
import { levelForXp } from './rules'

export function ProgressSummaryCard() {
  const stats = useProgressStats()
  const level = levelForXp(stats?.totalXp ?? 0)
  const streak = stats?.streak.current ?? 0
  return (
    <Link to="/progress" className="block rounded-2xl focus-visible:outline-none">
      <Card className="flex h-full flex-col justify-between gap-4 p-5 transition-shadow hover:shadow-md">
        <div className="flex items-center gap-4">
          <span className="flex size-12 flex-col items-center justify-center rounded-xl bg-primary text-primary-fg" aria-hidden>
            <span className="text-[10px] font-semibold uppercase opacity-80">Lvl</span>
            <span className="-mt-1 text-lg font-bold">{level.level}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Level {level.level}</p>
            <p className="text-sm text-muted tabular-nums">
              {stats?.totalXp ?? 0} XP · {level.next - (stats?.totalXp ?? 0)} to next level
            </p>
          </div>
          <span
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${streak > 0 ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted'}`}
            title={stats?.streak.activeToday ? 'You studied today' : 'Study today to keep your streak'}
          >
            <Flame className="size-4" aria-hidden />
            <span>
              {streak}
              <span className="sr-only"> day streak</span>
            </span>
          </span>
        </div>
        <ProgressBar value={level.progress * 100} label={`Progress to level ${level.level + 1}`} />
      </Card>
    </Link>
  )
}
