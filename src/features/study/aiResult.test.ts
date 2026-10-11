import { describe, expect, it } from 'vitest'
import { aiResponseSchema } from '../../services/ai/aiContract'
import { aiResponseToItems, combineNotes } from './aiResult'

describe('AI result handling', () => {
  it('rejects malformed responses at the boundary', () => {
    expect(aiResponseSchema.safeParse({ title: 'x' }).success).toBe(false)
    expect(aiResponseSchema.safeParse({ title: 'x', summary: '', reviewer: '', flashcards: [{ front: '', back: 'b', sourceRef: '' }], quiz: [] }).success).toBe(false)
  })

  it('converts valid items and drops inconsistent ones', () => {
    const { items, rejected } = aiResponseToItems({
      flashcards: [{ front: 'ATP', back: 'Energy currency', sourceRef: 'Page 2' }],
      quiz: [
        { type: 'multiple_choice', question: 'Q1', choices: ['A', 'B', 'C', 'D'], answer: 'B', explanation: '', sourceRef: '' },
        { type: 'multiple_choice', question: 'Q2', choices: ['A', 'B'], answer: 'Z', explanation: '', sourceRef: '' },
        { type: 'true_false', question: 'Q3', choices: [], answer: 'True', explanation: 'why', sourceRef: '' },
        { type: 'short_answer', question: 'Q4', choices: [], answer: 'Nucleus', explanation: '', sourceRef: '' },
      ],
    })
    expect(rejected).toBe(1)
    expect(items.map((i) => i.kind)).toEqual(['flashcard', 'multiple_choice', 'true_false', 'short_answer'])
    expect(items[0]?.sourceRef).toBe('Page 2')
    expect(items[2]?.answer).toBe('true')
  })

  it('combines reviewer and summary', () => {
    expect(combineNotes({ summary: '', reviewer: '' })).toBeNull()
    expect(combineNotes({ summary: 'S', reviewer: '' })).toBe('S')
    expect(combineNotes({ summary: 'S', reviewer: '# R' })).toBe('# R\n\n## Summary\n\nS')
  })
})
