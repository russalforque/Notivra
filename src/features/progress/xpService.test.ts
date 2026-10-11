import { describe, expect, it } from 'vitest'
import { db } from '../../db/database'
import { localDayKey, shiftDayKey } from '../../lib/time'
import { createNotebook } from '../library/libraryService'
import { flashcardSessionXp, levelForXp, quizSessionXp, xpForLevel } from './rules'
import { awardXp, computeStats, computeStreak, evaluateAchievements } from './xpService'
import { onPageSaved, onSessionCompleted } from './xpTriggers'
import { createRecord } from '../../db/repository'
import { listPages } from '../notebook/pageService'

describe('XP ledger', () => {
  it('awards each idempotency key exactly once, even under concurrent retries', async () => {
    const results = await Promise.all([
      awardXp({ key: 'session:1', type: 'quiz_session', amount: 20 }),
      awardXp({ key: 'session:1', type: 'quiz_session', amount: 20 }),
      awardXp({ key: 'session:1', type: 'quiz_session', amount: 20 }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await db.xpEvents.count()).toBe(1)
    expect((await computeStats()).totalXp).toBe(20)
  })

  it('rejects zero, negative and fractional awards', async () => {
    expect(await awardXp({ key: 'a', type: 'quiz_session', amount: 0 })).toBeNull()
    expect(await awardXp({ key: 'b', type: 'quiz_session', amount: -5 })).toBeNull()
    expect(await awardXp({ key: 'c', type: 'quiz_session', amount: 1.5 })).toBeNull()
  })

  it('stores events separately from totals (totals are derived)', async () => {
    await awardXp({ key: 'x1', type: 'daily_goal', amount: 15 })
    await awardXp({ key: 'x2', type: 'flashcard_session', amount: 25, subjectId: 'math' })
    const stats = await computeStats()
    expect(stats.totalXp).toBe(40)
    expect(stats.xpBySubject.get('math')).toBe(25)
  })
})

describe('levels and rewards', () => {
  it('maps XP to levels', () => {
    expect(xpForLevel(1)).toBe(0)
    expect(xpForLevel(2)).toBe(100)
    expect(levelForXp(0).level).toBe(1)
    expect(levelForXp(99).level).toBe(1)
    expect(levelForXp(100).level).toBe(2)
    expect(levelForXp(1000).level).toBe(5)
  })

  it('gives nothing for trivially short sessions and caps rewards', () => {
    expect(flashcardSessionXp(2)).toBe(0)
    expect(flashcardSessionXp(10)).toBe(20)
    expect(flashcardSessionXp(500)).toBe(40)
    expect(quizSessionXp(2, 2)).toBe(0)
    expect(quizSessionXp(10, 10)).toBe(30)
  })
})

describe('streaks', () => {
  const today = '2026-03-10'
  it('counts consecutive days ending today or yesterday', () => {
    expect(computeStreak(['2026-03-08', '2026-03-09', '2026-03-10'], today)).toMatchObject({ current: 3, activeToday: true })
    expect(computeStreak(['2026-03-08', '2026-03-09'], today)).toMatchObject({ current: 2, activeToday: false })
    expect(computeStreak(['2026-03-07'], today).current).toBe(0)
  })
  it('tracks the longest run', () => {
    expect(computeStreak(['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-03-10'], today).longest).toBe(4)
  })
  it('handles month boundaries', () => {
    expect(computeStreak(['2026-02-28', '2026-03-01'], '2026-03-01').current).toBe(2)
  })
})

describe('triggers and achievements', () => {
  it('awards page XP once per page and only for meaningful content', async () => {
    const nb = await createNotebook({ title: 'Bio' })
    const [page] = await listPages(nb.id)
    await onPageSaved({ ...page!, strokes: [] })
    expect(await db.xpEvents.count()).toBe(0)
    const strokes = Array.from({ length: 25 }, (_, i) => ({ id: String(i), tool: 'pen' as const, color: '#000000', size: 2, points: [0, 0, 0.5] }))
    await onPageSaved({ ...page!, strokes })
    await onPageSaved({ ...page!, strokes })
    expect(await db.xpEvents.count()).toBe(1)
  })

  it('does not award session XP twice when completion is retried', async () => {
    const set = await createRecord('studySets', { title: 'Set', subjectId: null, description: '', summary: null, origin: 'manual', source: null })
    const session = await createRecord('studySessions', {
      setId: set.id,
      mode: 'quiz',
      startedAt: Date.now(),
      completedAt: Date.now(),
      answers: [],
      correctCount: 5,
      totalCount: 5,
    })
    const first = await onSessionCompleted(session)
    const second = await onSessionCompleted(session)
    expect(first.xp).toBe(20 + 15) // quiz + daily goal
    expect(second.xp).toBe(0)
  })

  it('unlocks achievements once based on stored data', async () => {
    await createNotebook({ title: 'One' })
    const first = await evaluateAchievements()
    expect(first.map((u) => u.achievementId)).toContain('first-notebook')
    expect(await evaluateAchievements()).toHaveLength(0)
  })

  it('unlocks streak achievements from XP history', async () => {
    const today = localDayKey()
    for (let i = 0; i < 3; i++) {
      const day = shiftDayKey(today, -i)
      const [y, m, d] = day.split('-').map(Number) as [number, number, number]
      await awardXp({ key: `day${i}`, type: 'daily_goal', amount: 15, at: new Date(y, m - 1, d, 12).getTime() })
    }
    const unlocked = (await evaluateAchievements()).map((u) => u.achievementId)
    expect(unlocked).toContain('streak-3')
    expect(unlocked).not.toContain('streak-7')
  })
})
