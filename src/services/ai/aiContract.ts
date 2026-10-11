import { z } from 'zod'

/** Keep in sync with supabase/functions/ai-generate/index.ts. */
export const MAX_AI_INPUT_CHARS = 60_000
export const MIN_AI_INPUT_CHARS = 200

export const aiOutputKinds = ['summary', 'reviewer', 'flashcards', 'quiz'] as const
export type AiOutputKind = (typeof aiOutputKinds)[number]

export const aiRequestSchema = z.object({
  outputs: z.array(z.enum(aiOutputKinds)).min(1, 'Choose at least one thing to generate.').max(4),
  text: z
    .string()
    .trim()
    .min(MIN_AI_INPUT_CHARS, 'There is not enough text to work with (at least 200 characters are needed).')
    .max(MAX_AI_INPUT_CHARS, 'The source text is too long. Select fewer pages.'),
  sourceLabel: z.string().trim().max(200),
  flashcardCount: z.number().int().min(1).max(40),
  quizCount: z.number().int().min(1).max(30),
})
export type AiRequest = z.infer<typeof aiRequestSchema>

export const aiFlashcardSchema = z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(2000),
  sourceRef: z.string().max(100),
})

export const aiQuizItemSchema = z.object({
  type: z.enum(['multiple_choice', 'true_false', 'short_answer']),
  question: z.string().min(1).max(2000),
  choices: z.array(z.string().min(1).max(500)).max(6),
  answer: z.string().min(1).max(1000),
  explanation: z.string().max(2000),
  sourceRef: z.string().max(100),
})

export const aiResponseSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(20_000),
  reviewer: z.string().max(40_000),
  flashcards: z.array(aiFlashcardSchema).max(40),
  quiz: z.array(aiQuizItemSchema).max(30),
  model: z.string().optional(),
  remainingToday: z.number().nullable().optional(),
})
export type AiResponse = z.infer<typeof aiResponseSchema>
export type AiFlashcard = z.infer<typeof aiFlashcardSchema>
export type AiQuizItem = z.infer<typeof aiQuizItemSchema>
