import {
  Award,
  BookOpen,
  Brain,
  Copy,
  Flame,
  Footprints,
  Highlighter,
  Layers,
  Lock,
  PenLine,
  Repeat,
  Star,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react'
import { Card, PageHeader, ProgressBar, Spinner } from '../../components/ui/misc'
import { useNow } from '../../hooks/useNow'
import { cn } from '../../lib/cn'
import { localDayKey, shiftDayKey } from '../../lib/time'
import { useSubjects } from '../library/hooks'
import { ACHIEVEMENTS } from './achievements'
import { useProgressStats, useUnlockedAchievements } from './hooks'
import { XP_RULES, levelForXp } from './rules'
import type { ProgressStats } from './xpService'

const ICONS: Record<string, LucideIcon> = {
  notebook: BookOpen,
  pen: PenLine,
  highlighter: Highlighter,
  layers: Layers,
  footprints: Footprints,
  repeat: Repeat,
  copy: Copy,
  brain: Brain,
  target: Target,
  flame: Flame,
  trophy: Trophy,
  star: Star,
  award: Award,
}

export function ProgressPage() {
  const stats = useProgressStats()
  const unlocked = useUnlockedAchievements()
  const subjects = useSubjects() ?? []
  const now = useNow()

  if (!stats || !unlocked) return <Spinner />
  const level = levelForXp(stats.totalXp)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Progress" description="XP comes from real study: finished sessions, reviewed cards and meaningful notes — never from repeated clicks." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex flex-col gap-3 p-5 sm:col-span-2">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-muted">Level</p>
            <p className="text-sm text-muted tabular-nums">
              {stats.totalXp - level.current} / {level.next - level.current} XP
            </p>
          </div>
          <p className="text-4xl font-bold tracking-tight">{level.level}</p>
          <ProgressBar value={level.progress * 100} label={`Progress to level ${level.level + 1}`} />
          <p className="text-xs text-muted">{level.next - stats.totalXp} XP to level {level.level + 1}</p>
        </Card>
        <StatTile label="Study streak" value={`${stats.streak.current} day${stats.streak.current === 1 ? '' : 's'}`} detail={`Longest: ${stats.streak.longest} · ${stats.streak.activeToday ? 'studied today ✓' : 'study today to keep it'}`} />
        <StatTile label="Total XP" value={stats.totalXp.toLocaleString()} detail={`${stats.sessionsCompleted} sessions · ${stats.cardsReviewed} cards reviewed`} />
      </div>

      <DailyXpChart stats={stats} now={now} />

      <SubjectBars stats={stats} subjects={subjects} />

      <section aria-labelledby="achievements-heading">
        <h2 id="achievements-heading" className="mb-3 text-lg font-semibold">
          Achievements <span className="text-sm font-normal text-muted">({unlocked.size} of {ACHIEVEMENTS.length})</span>
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACHIEVEMENTS.map((a) => {
            const at = unlocked.get(a.id)
            const Icon = ICONS[a.icon] ?? Award
            const value = a.metric === 'streak' ? Math.max(stats.streak.current, stats.streak.longest) : (stats[a.metric] as number)
            return (
              <li key={a.id}>
                <Card className={cn('flex h-full items-start gap-3 p-4', !at && 'bg-surface-2/60')}>
                  <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', at ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-muted')}>
                    {at ? <Icon className="size-5" aria-hidden /> : <Lock className="size-5" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {a.title}
                      <span className="sr-only">{at ? ' (unlocked)' : ' (locked)'}</span>
                    </p>
                    <p className="text-sm text-muted">{a.description}</p>
                    {at ? (
                      <p className="mt-1 text-xs text-muted">Unlocked {new Date(at).toLocaleDateString()}</p>
                    ) : (
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={Math.min(value, a.threshold)} max={a.threshold} label={`${a.title} progress`} className="h-1.5" />
                        <span className="shrink-0 text-xs text-muted tabular-nums">
                          {Math.min(value, a.threshold).toLocaleString()}/{a.threshold.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      </section>

      <Card className="p-5">
        <h2 className="mb-2 font-semibold">How XP works</h2>
        <ul className="grid gap-1 text-sm text-muted sm:grid-cols-2">
          <li>
            Flashcard session (≥{XP_RULES.flashcardSession.minItems} cards): {XP_RULES.flashcardSession.base} + {XP_RULES.flashcardSession.perItem} per card, max {XP_RULES.flashcardSession.max}
          </li>
          <li>
            Quiz (≥{XP_RULES.quizSession.minItems} questions): {XP_RULES.quizSession.base} + {XP_RULES.quizSession.perCorrect} per correct answer, max {XP_RULES.quizSession.max}
          </li>
          <li>First study session each day: +{XP_RULES.dailyGoal.amount}</li>
          <li>
            A notebook page with real content: +{XP_RULES.pageWritten.amount} once per page (up to {XP_RULES.pageWritten.dailyCap}/day)
          </li>
          <li>
            Annotating a PDF ({XP_RULES.documentAnnotated.minAnnotations}+ marks): +{XP_RULES.documentAnnotated.amount} once per PDF
          </li>
          <li>
            Building a study set ({XP_RULES.studySetCreated.minItems}+ items): +{XP_RULES.studySetCreated.amount} once per set
          </li>
        </ul>
      </Card>
    </div>
  )
}

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted">{detail}</p>
    </Card>
  )
}

/** Single series → one hue, no legend; bars are focusable with a hover/focus tooltip and a table view. */
function DailyXpChart({ stats, now }: { stats: ProgressStats; now: number }) {
  const today = localDayKey(now)
  const days = Array.from({ length: 14 }, (_, i) => shiftDayKey(today, i - 13))
  const values = days.map((d) => stats.xpByDay.get(d) ?? 0)
  const max = Math.max(10, ...values)
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-semibold">XP — last 14 days</h2>
        <p className="text-sm text-muted tabular-nums">{values.reduce((a, b) => a + b, 0)} XP</p>
      </div>
      <div className="relative">
        {/* recessive gridline at the max value */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden />
        <span className="pointer-events-none absolute -top-2.5 right-0 bg-surface pl-1 text-[10px] text-muted tabular-nums" aria-hidden>
          {max}
        </span>
        <div className="flex h-36 items-end gap-[2px] border-b border-border" role="list" aria-label="XP per day">
          {days.map((d, i) => {
            const v = values[i]!
            return (
              <div key={d} role="listitem" className="group relative flex h-full flex-1 items-end justify-center" tabIndex={0} aria-label={`${label(d)}: ${v} XP`}>
                <div
                  className={cn('w-full max-w-7 rounded-t-[4px] transition-colors', v > 0 ? 'bg-primary group-hover:bg-primary-hover group-focus:bg-primary-hover' : 'bg-surface-3')}
                  style={{ height: v > 0 ? `${Math.max(4, (v / max) * 100)}%` : 2 }}
                />
                <span className="pointer-events-none absolute bottom-full mb-1 hidden rounded-md border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap text-fg shadow-md group-hover:block group-focus:block">
                  {label(d)} · <strong className="tabular-nums">{v} XP</strong>
                </span>
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex gap-[2px] text-[10px] text-muted" aria-hidden>
          {days.map((d, i) => (
            <span key={d} className="flex-1 text-center">
              {i % 2 === 1 || i === 13 ? new Date(`${d}T12:00:00`).getDate() : ''}
            </span>
          ))}
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">XP</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d} className="border-t border-border">
                <td className="py-1">{label(d)}</td>
                <td className="py-1 text-right tabular-nums">{values[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  )
}

/** Magnitude per subject: every bar is direct-labelled, so colour is never the only identity cue. */
function SubjectBars({ stats, subjects }: { stats: ProgressStats; subjects: { id: string; name: string; color: string }[] }) {
  const rows = [
    ...subjects.map((s) => ({ key: s.id, name: s.name, color: s.color, xp: stats.xpBySubject.get(s.id) ?? 0 })),
    { key: 'none', name: 'General / no subject', color: 'var(--muted)', xp: stats.xpBySubject.get(null) ?? 0 },
  ]
    .filter((r) => r.xp > 0)
    .sort((a, b) => b.xp - a.xp)
  const max = Math.max(1, ...rows.map((r) => r.xp))

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">XP by subject</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Study a set or write in a notebook that belongs to a subject to see subject progress here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate font-medium">{r.name}</span>
              <span className="h-3 overflow-hidden rounded-r-[4px] bg-surface-2" aria-hidden>
                <span className="block h-full rounded-r-[4px]" style={{ width: `${(r.xp / max) * 100}%`, backgroundColor: r.color }} />
              </span>
              <span className="text-right text-muted tabular-nums">{r.xp} XP</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
