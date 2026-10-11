import { describe, expect, it } from 'vitest'
import { DAY_MS } from '../../lib/time'
import { isShortAnswerCorrect, normalizeAnswer } from './answerCheck'
import { newSrsState, scheduleReview } from './srs'

describe('spaced repetition', () => {
  const t0 = 1_000_000_000_000
  it('grows intervals on successful reviews', () => {
    let s = newSrsState(t0)
    s = scheduleReview(s, 'good', t0)
    expect(s.intervalDays).toBe(1)
    s = scheduleReview(s, 'good', t0)
    expect(s.intervalDays).toBe(3)
    s = scheduleReview(s, 'good', t0)
    expect(s.intervalDays).toBe(7.5)
    expect(s.dueAt).toBe(t0 + 7.5 * DAY_MS)
  })

  it('resets on "again" and lowers ease, but never below the minimum', () => {
    let s = newSrsState(t0)
    for (let i = 0; i < 20; i++) s = scheduleReview(s, 'again', t0)
    expect(s.ease).toBe(1.3)
    expect(s.reps).toBe(0)
    expect(s.lapses).toBe(20)
    expect(s.dueAt - t0).toBe(10 * 60 * 1000)
  })

  it('caps intervals at a year', () => {
    let s = newSrsState(t0)
    for (let i = 0; i < 30; i++) s = scheduleReview(s, 'easy', t0)
    expect(s.intervalDays).toBe(365)
  })
})

describe('short answer checking', () => {
  it('ignores case, accents, punctuation and articles', () => {
    expect(normalizeAnswer('  The Mitochondrion! ')).toBe('mitochondrion')
    expect(isShortAnswerCorrect('mitochondrion', 'The mitochondrion')).toBe(true)
    expect(isShortAnswerCorrect('Pokémon', 'pokemon')).toBe(true)
  })

  it('tolerates small typos on longer answers only', () => {
    expect(isShortAnswerCorrect('photosynthsis', 'photosynthesis')).toBe(true)
    expect(isShortAnswerCorrect('cat', 'car')).toBe(false)
    expect(isShortAnswerCorrect('photo', 'photosynthesis')).toBe(false)
  })

  it('requires exact numbers', () => {
    expect(isShortAnswerCorrect('1945', '1944')).toBe(false)
    expect(isShortAnswerCorrect('1945', '1945')).toBe(true)
  })

  it('accepts alternative answers and rejects empty responses', () => {
    expect(isShortAnswerCorrect('DNA', 'deoxyribonucleic acid', ['DNA'])).toBe(true)
    expect(isShortAnswerCorrect('   ', 'x')).toBe(false)
  })
})

describe('due cards', () => {
  it('treats never-reviewed cards as due and respects the schedule afterwards', async () => {
    const { isDue } = await import('./srs')
    const t0 = 1_000_000
    const fresh = { ...newSrsState(t0 + 5_000) }
    expect(isDue(fresh, t0)).toBe(true) // created "after" the clock reading: still due
    const lapsed = scheduleReview(fresh, 'again', t0)
    expect(isDue(lapsed, t0)).toBe(false)
    expect(isDue(lapsed, t0 + 11 * 60 * 1000)).toBe(true)
  })
})
