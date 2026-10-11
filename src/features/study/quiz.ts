import type { StudyItem } from '../../db/types'
import { isShortAnswerCorrect } from './answerCheck'

export type QuizQuestion =
  | { kind: 'multiple_choice'; item: StudyItem; prompt: string; choices: string[]; answer: string }
  | { kind: 'true_false'; item: StudyItem; prompt: string; answer: 'true' | 'false' }
  | { kind: 'short_answer'; item: StudyItem; prompt: string; answer: string; accepted: string[] }
  /** Flashcard without enough material for distractors: reveal, then the student self-grades. */
  | { kind: 'self_check'; item: StudyItem; prompt: string; answer: string }

export function shuffle<T>(list: T[], random: () => number = Math.random): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

export const MAX_QUIZ_QUESTIONS = 25

/**
 * Builds quiz questions from study items. Flashcards become multiple choice using other
 * cards' answers as distractors (needs at least 3 distinct other answers).
 */
export function buildQuiz(items: StudyItem[], random: () => number = Math.random, max = MAX_QUIZ_QUESTIONS): QuizQuestion[] {
  const flashAnswers = Array.from(new Set(items.filter((i) => i.kind === 'flashcard').map((i) => i.answer.trim())))
  const questions = items.map((item): QuizQuestion => {
    switch (item.kind) {
      case 'multiple_choice':
        return { kind: 'multiple_choice', item, prompt: item.prompt, choices: shuffle(item.choices, random), answer: item.answer }
      case 'true_false':
        return { kind: 'true_false', item, prompt: item.prompt, answer: item.answer === 'false' ? 'false' : 'true' }
      case 'short_answer':
        return { kind: 'short_answer', item, prompt: item.prompt, answer: item.answer, accepted: item.acceptedAnswers }
      case 'flashcard': {
        const distractors = shuffle(flashAnswers.filter((a) => a !== item.answer.trim()), random).slice(0, 3)
        if (distractors.length < 3) return { kind: 'self_check', item, prompt: item.prompt, answer: item.answer }
        return { kind: 'multiple_choice', item, prompt: item.prompt, choices: shuffle([item.answer.trim(), ...distractors], random), answer: item.answer.trim() }
      }
    }
  })
  return shuffle(questions, random).slice(0, max)
}

export function checkAnswer(q: QuizQuestion, response: string): boolean {
  switch (q.kind) {
    case 'multiple_choice':
      return response === q.answer
    case 'true_false':
      return response === q.answer
    case 'short_answer':
      return isShortAnswerCorrect(response, q.answer, q.accepted)
    case 'self_check':
      return response === 'correct'
  }
}
