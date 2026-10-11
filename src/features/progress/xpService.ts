import Dexie from 'dexie'
import { db } from '../../db/database'
import { createRecord } from '../../db/repository'
import type { UserAchievement, XpEvent, XpEventType } from '../../db/types'
import { localDayKey, now, shiftDayKey } from '../../lib/time'
import { ACHIEVEMENTS } from './achievements'

export interface AwardInput {
  /** Idempotency key — the same real-world action must always produce the same key. */
  key: string
  type: XpEventType
  amount: number
  subjectId?: string | null
  at?: number
}

/**
 * Appends an XP event exactly once per key. Returns null if the key was already awarded.
 * The unique `&key` index makes this safe even with concurrent calls from several tabs.
 */
export async function awardXp(input: AwardInput): Promise<XpEvent | null> {
  if (input.amount <= 0 || !Number.isInteger(input.amount)) return null
  const at = input.at ?? now()
  try {
    return await db.transaction('rw', db.xpEvents, db.syncQueue, async () => {
      if ((await db.xpEvents.where('key').equals(input.key).count()) > 0) return null
      return createRecord('xpEvents', {
        key: input.key,
        type: input.type,
        amount: input.amount,
        subjectId: input.subjectId ?? null,
        dayKey: localDayKey(at),
        occurredAt: at,
      })
    })
  } catch (error) {
    if (error instanceof Dexie.ConstraintError || (error as Error)?.name === 'ConstraintError') return null
    throw error
  }
}

export async function hasXpKey(key: string): Promise<boolean> {
  return (await db.xpEvents.where('key').equals(key).count()) > 0
}

export async function xpOnDay(type: XpEventType, dayKey: string): Promise<number> {
  const events = await db.xpEvents.where('dayKey').equals(dayKey).toArray()
  return events.filter((e) => e.type === type && e.deletedAt === null).reduce((sum, e) => sum + e.amount, 0)
}

export interface StreakInfo {
  current: number
  longest: number
  activeToday: boolean
}

/**
 * Consecutive local days with any study activity. A streak stays alive until the end of the
 * day after the last activity (so it doesn't show 0 in the morning before you study).
 */
export function computeStreak(dayKeys: Iterable<string>, today = localDayKey()): StreakInfo {
  const days = new Set(dayKeys)
  const activeToday = days.has(today)
  let current = 0
  let cursor = activeToday ? today : shiftDayKey(today, -1)
  while (days.has(cursor)) {
    current++
    cursor = shiftDayKey(cursor, -1)
  }
  let longest = 0
  for (const d of days) {
    if (days.has(shiftDayKey(d, -1))) continue // not the start of a run
    let len = 0
    let c = d
    while (days.has(c)) {
      len++
      c = shiftDayKey(c, 1)
    }
    longest = Math.max(longest, len)
  }
  return { current, longest, activeToday }
}

export interface ProgressStats {
  totalXp: number
  streak: StreakInfo
  sessionsCompleted: number
  cardsReviewed: number
  perfectQuizzes: number
  notebooksCreated: number
  pagesWritten: number
  documentsAnnotated: number
  studySetsCreated: number
  xpBySubject: Map<string | null, number>
  xpByDay: Map<string, number>
}

export async function computeStats(): Promise<ProgressStats> {
  const [events, sessions, notebooks, sets] = await Promise.all([
    db.xpEvents.toArray(),
    db.studySessions.toArray(),
    db.notebooks.toArray(),
    db.studySets.toArray(),
  ])
  const liveEvents = events.filter((e) => e.deletedAt === null)
  const completed = sessions.filter((s) => s.completedAt !== null && s.deletedAt === null)
  const xpBySubject = new Map<string | null, number>()
  const xpByDay = new Map<string, number>()
  for (const e of liveEvents) {
    xpBySubject.set(e.subjectId, (xpBySubject.get(e.subjectId) ?? 0) + e.amount)
    xpByDay.set(e.dayKey, (xpByDay.get(e.dayKey) ?? 0) + e.amount)
  }
  return {
    totalXp: liveEvents.reduce((sum, e) => sum + e.amount, 0),
    streak: computeStreak(liveEvents.filter((e) => e.type !== 'achievement').map((e) => e.dayKey)),
    sessionsCompleted: completed.length,
    cardsReviewed: completed.filter((s) => s.mode === 'flashcards').reduce((sum, s) => sum + s.answers.length, 0),
    perfectQuizzes: completed.filter((s) => s.mode === 'quiz' && s.totalCount >= 5 && s.correctCount === s.totalCount).length,
    // Creation counts include items later deleted: deleting must not revoke past achievements.
    notebooksCreated: notebooks.length,
    pagesWritten: liveEvents.filter((e) => e.type === 'page_written').length,
    documentsAnnotated: liveEvents.filter((e) => e.type === 'document_annotated').length,
    studySetsCreated: sets.length,
    xpBySubject,
    xpByDay,
  }
}

/** Unlocks every achievement whose criterion is now met. Returns the newly unlocked ones. */
export async function evaluateAchievements(): Promise<UserAchievement[]> {
  const stats = await computeStats()
  const unlocked = new Set((await db.userAchievements.toArray()).map((u) => u.achievementId))
  const metricValue = (metric: (typeof ACHIEVEMENTS)[number]['metric']): number =>
    metric === 'streak' ? Math.max(stats.streak.current, stats.streak.longest) : stats[metric]
  const fresh: UserAchievement[] = []
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id) || metricValue(a.metric) < a.threshold) continue
    try {
      fresh.push(await createRecord('userAchievements', { achievementId: a.id, unlockedAt: now() }))
    } catch (error) {
      if ((error as Error)?.name !== 'ConstraintError') throw error // already unlocked in another tab
    }
  }
  return fresh
}
