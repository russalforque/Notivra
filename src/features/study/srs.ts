import type { ReviewGrade, SrsState } from '../../db/types'
import { DAY_MS } from '../../lib/time'

/**
 * Spaced repetition scheduling — a simplified SM-2. Kept deliberately small and predictable
 * for students: "Again" brings the card back in the same session soon, "Good" roughly
 * multiplies the interval by the card's ease, "Easy" pushes it further.
 */
export const MIN_EASE = 1.3
const AGAIN_DELAY_MS = 10 * 60 * 1000

export function newSrsState(at = Date.now()): SrsState {
  return { dueAt: at, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, lastReviewedAt: null }
}

export function scheduleReview(state: SrsState, grade: ReviewGrade, at = Date.now()): SrsState {
  let { intervalDays, ease, reps, lapses } = state
  switch (grade) {
    case 'again':
      lapses += 1
      reps = 0
      ease = Math.max(MIN_EASE, ease - 0.2)
      return { dueAt: at + AGAIN_DELAY_MS, intervalDays: 0, ease, reps, lapses, lastReviewedAt: at }
    case 'hard':
      ease = Math.max(MIN_EASE, ease - 0.15)
      intervalDays = reps === 0 ? 1 : Math.max(1, intervalDays * 1.2)
      break
    case 'good':
      intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : intervalDays * ease
      break
    case 'easy':
      ease = ease + 0.15
      intervalDays = reps === 0 ? 4 : intervalDays * ease * 1.3
      break
  }
  intervalDays = Math.min(365, Math.round(intervalDays * 10) / 10)
  return { dueAt: at + intervalDays * DAY_MS, intervalDays, ease: Math.round(ease * 100) / 100, reps: reps + 1, lapses, lastReviewedAt: at }
}

/** New (never reviewed) cards are always due; others when their due time has passed. */
export function isDue(state: SrsState, at = Date.now()): boolean {
  return state.lastReviewedAt === null || state.dueAt <= at
}

/** Human label for the next interval a grade would produce ("10m", "3d"…). */
export function previewInterval(state: SrsState, grade: ReviewGrade): string {
  const next = scheduleReview(state, grade, 0)
  if (next.intervalDays === 0) return '10m'
  if (next.intervalDays < 30) return `${Math.round(next.intervalDays)}d`
  return `${Math.round(next.intervalDays / 30)}mo`
}
