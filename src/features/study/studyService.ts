import { z } from 'zod'
import { db } from '../../db/database'
import { createMany, createRecord, softDelete, softDeleteMany, stampNew, updateRecord } from '../../db/repository'
import type { ReviewGrade, SessionAnswer, StudyItem, StudyItemKind, StudySession, StudySet, StudySource } from '../../db/types'
import { ValidationError } from '../../lib/errors'
import { parseOrThrow, titleSchema } from '../../lib/validation'
import { newSrsState, scheduleReview } from './srs'

// ───────────── validation ─────────────

const text = (label: string, max: number) => z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`)

export const studyItemInputSchema = z
  .object({
    kind: z.enum(['flashcard', 'multiple_choice', 'true_false', 'short_answer']),
    prompt: text('The question / front', 4000),
    answer: text('The answer', 4000),
    choices: z.array(z.string().trim().min(1).max(1000)).max(8).default([]),
    acceptedAnswers: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
    explanation: z.string().trim().max(4000).default(''),
    sourceRef: z.string().trim().max(200).nullable().default(null),
  })
  .superRefine((item, ctx) => {
    if (item.kind === 'multiple_choice') {
      if (item.choices.length < 2) ctx.addIssue({ code: 'custom', message: 'Multiple choice needs at least 2 options.' })
      if (!item.choices.includes(item.answer)) ctx.addIssue({ code: 'custom', message: 'The correct answer must be one of the options.' })
      if (new Set(item.choices.map((c) => c.toLowerCase())).size !== item.choices.length) ctx.addIssue({ code: 'custom', message: 'Options must be different.' })
    }
    if (item.kind === 'true_false' && item.answer !== 'true' && item.answer !== 'false') {
      ctx.addIssue({ code: 'custom', message: 'True/false answers must be “true” or “false”.' })
    }
  })

export type StudyItemInput = z.input<typeof studyItemInputSchema>

// ───────────── sets ─────────────

export async function createStudySet(input: {
  title: string
  subjectId?: string | null
  description?: string
  summary?: string | null
  origin?: 'manual' | 'ai'
  source?: StudySource | null
}): Promise<StudySet> {
  return createRecord('studySets', {
    title: parseOrThrow(titleSchema, input.title),
    subjectId: input.subjectId ?? null,
    description: (input.description ?? '').slice(0, 2000),
    summary: input.summary ?? null,
    origin: input.origin ?? 'manual',
    source: input.source ?? null,
  })
}

/** Creates a set with all its items in one transaction (used for AI results and imports). */
export async function createStudySetWithItems(
  set: Parameters<typeof createStudySet>[0],
  items: StudyItemInput[],
): Promise<StudySet> {
  const parsed = items.map((i) => parseOrThrow(studyItemInputSchema, i))
  return db.transaction('rw', [db.studySets, db.studyItems, db.syncQueue], async () => {
    const created = await createStudySet(set)
    const now = Date.now()
    await createMany(
      'studyItems',
      parsed.map((p, index) => stampNew<'studyItems'>({ ...p, setId: created.id, sortOrder: index, srs: newSrsState(now) })),
    )
    return created
  })
}

export async function updateStudySet(id: string, patch: Partial<Pick<StudySet, 'title' | 'description' | 'subjectId' | 'summary'>>): Promise<void> {
  await updateRecord('studySets', id, {
    ...patch,
    ...(patch.title !== undefined && { title: parseOrThrow(titleSchema, patch.title) }),
  })
}

export async function deleteStudySet(id: string): Promise<void> {
  await db.transaction('rw', [db.studySets, db.studyItems, db.syncQueue], async () => {
    const items = await db.studyItems.where('setId').equals(id).primaryKeys()
    await softDeleteMany('studyItems', items)
    await softDelete('studySets', id)
  })
}

// ───────────── items ─────────────

export async function listItems(setId: string): Promise<StudyItem[]> {
  const items = await db.studyItems.where('[setId+sortOrder]').between([setId, -Infinity], [setId, Infinity]).toArray()
  return items.filter((i) => i.deletedAt === null)
}

export async function addItem(setId: string, input: StudyItemInput): Promise<StudyItem> {
  const parsed = parseOrThrow(studyItemInputSchema, input)
  const existing = await listItems(setId)
  const sortOrder = existing.length ? existing[existing.length - 1]!.sortOrder + 1 : 0
  return createRecord('studyItems', { ...parsed, setId, sortOrder, srs: newSrsState() })
}

export async function updateItem(id: string, input: StudyItemInput): Promise<void> {
  const parsed = parseOrThrow(studyItemInputSchema, input)
  await updateRecord('studyItems', id, parsed)
}

export async function deleteItem(id: string): Promise<void> {
  await softDelete('studyItems', id)
}

// ───────────── sessions ─────────────

export async function startSession(setId: string, mode: StudySession['mode'], totalCount: number): Promise<StudySession> {
  if (totalCount < 1) throw new ValidationError('This study set has no items to study yet.')
  return createRecord('studySessions', { setId, mode, startedAt: Date.now(), completedAt: null, answers: [], correctCount: 0, totalCount })
}

/**
 * Records one answer. Each answer is written immediately so progress survives the app being
 * closed mid-session. Flashcard grades also update the card's review schedule.
 */
export async function recordAnswer(sessionId: string, answer: SessionAnswer): Promise<StudySession> {
  return db.transaction('rw', [db.studySessions, db.studyItems, db.syncQueue], async () => {
    const session = await updateRecord('studySessions', sessionId, (s) => {
      // Idempotent per item: re-answering the same item replaces the previous answer.
      const answers = [...s.answers.filter((a) => a.itemId !== answer.itemId), answer]
      return { answers, correctCount: answers.filter((a) => a.correct).length }
    })
    if (answer.grade) await applyGrade(answer.itemId, answer.grade, answer.at)
    return session
  })
}

export async function applyGrade(itemId: string, grade: ReviewGrade, at = Date.now()): Promise<void> {
  const item = await db.studyItems.get(itemId)
  if (!item || item.deletedAt !== null) return
  await updateRecord('studyItems', itemId, { srs: scheduleReview(item.srs, grade, at) })
}

export async function completeSession(sessionId: string): Promise<StudySession> {
  return updateRecord('studySessions', sessionId, (s) => (s.completedAt ? {} : { completedAt: Date.now() }))
}

export function itemKindLabel(kind: StudyItemKind): string {
  return { flashcard: 'Flashcard', multiple_choice: 'Multiple choice', true_false: 'True / false', short_answer: 'Short answer' }[kind]
}
