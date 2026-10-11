import { describe, expect, it } from 'vitest'
import type { StudyItem, StudyItemKind } from '../../db/types'
import { newSrsState } from './srs'
import { buildQuiz, checkAnswer } from './quiz'

let n = 0
const item = (kind: StudyItemKind, prompt: string, answer: string, choices: string[] = []): StudyItem => ({
  id: `i${++n}`,
  ownerId: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  rev: 1,
  serverRev: null,
  syncStatus: 'pending',
  setId: 's',
  kind,
  prompt,
  answer,
  choices,
  acceptedAnswers: [],
  explanation: '',
  sourceRef: null,
  sortOrder: n,
  srs: newSrsState(0),
})

/** Deterministic PRNG for reproducible shuffles. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
}

describe('quiz builder', () => {
  it('turns flashcards into multiple choice with distinct distractors when possible', () => {
    const cards = ['ATP', 'DNA', 'RNA', 'Ribosome', 'Nucleus'].map((a, i) => item('flashcard', `Q${i}`, a))
    const quiz = buildQuiz(cards, seeded(42))
    expect(quiz).toHaveLength(5)
    for (const q of quiz) {
      expect(q.kind).toBe('multiple_choice')
      if (q.kind !== 'multiple_choice') continue
      expect(q.choices).toHaveLength(4)
      expect(new Set(q.choices).size).toBe(4)
      expect(q.choices).toContain(q.answer)
    }
  })

  it('falls back to self-check when there are too few flashcards', () => {
    const quiz = buildQuiz([item('flashcard', 'Q', 'A'), item('flashcard', 'Q2', 'B')], seeded(1))
    expect(quiz.every((q) => q.kind === 'self_check')).toBe(true)
  })

  it('keeps authored question types and checks answers', () => {
    const quiz = buildQuiz(
      [item('multiple_choice', 'Pick', 'B', ['A', 'B', 'C']), item('true_false', 'Sky is green', 'false'), item('short_answer', 'Powerhouse?', 'Mitochondria')],
      seeded(7),
    )
    const byKind = Object.fromEntries(quiz.map((q) => [q.kind, q]))
    expect(checkAnswer(byKind.multiple_choice!, 'B')).toBe(true)
    expect(checkAnswer(byKind.multiple_choice!, 'A')).toBe(false)
    expect(checkAnswer(byKind.true_false!, 'false')).toBe(true)
    expect(checkAnswer(byKind.short_answer!, 'the mitochondria')).toBe(true)
  })

  it('caps the number of questions', () => {
    const many = Array.from({ length: 40 }, (_, i) => item('true_false', `S${i}`, 'true'))
    expect(buildQuiz(many, seeded(3), 25)).toHaveLength(25)
  })
})
