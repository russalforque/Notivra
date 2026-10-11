import type { AiResponse } from '../../services/ai/aiContract'
import { studyItemInputSchema, type StudyItemInput } from './studyService'

/** Converts a validated AI response into study items; invalid items are reported, not saved. */
export function aiResponseToItems(result: Pick<AiResponse, 'flashcards' | 'quiz'>): { items: StudyItemInput[]; rejected: number } {
  const candidates: StudyItemInput[] = [
    ...result.flashcards.map((f) => ({ kind: 'flashcard' as const, prompt: f.front, answer: f.back, sourceRef: f.sourceRef || null })),
    ...result.quiz.map((q) => ({
      kind: q.type,
      prompt: q.question,
      answer: q.type === 'true_false' ? q.answer.trim().toLowerCase() : q.answer,
      choices: q.type === 'multiple_choice' ? q.choices : [],
      explanation: q.explanation,
      sourceRef: q.sourceRef || null,
    })),
  ]
  const items = candidates.filter((c) => studyItemInputSchema.safeParse(c).success)
  return { items, rejected: candidates.length - items.length }
}

/** Combines the reviewer and summary into the set's Markdown notes. */
export function combineNotes(result: Pick<AiResponse, 'summary' | 'reviewer'>): string | null {
  const parts: string[] = []
  if (result.reviewer.trim()) parts.push(result.reviewer.trim())
  if (result.summary.trim()) parts.push(`${parts.length ? '## Summary\n\n' : ''}${result.summary.trim()}`)
  return parts.length ? parts.join('\n\n') : null
}
