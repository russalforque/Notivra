import { toast } from '../../components/ui/toast'
import { db } from '../../db/database'
import type { Page, StudySession } from '../../db/types'
import { localDayKey } from '../../lib/time'
import { ACHIEVEMENTS } from './achievements'
import { XP_RULES, flashcardSessionXp, quizSessionXp } from './rules'
import { awardXp, evaluateAchievements, hasXpKey, xpOnDay } from './xpService'

/**
 * Glue between user actions and the XP ledger. All functions are fire-and-forget safe:
 * gamification must never break or slow down note-taking, so errors are only logged.
 */

async function announceAchievements(): Promise<void> {
  for (const u of await evaluateAchievements()) {
    const a = ACHIEVEMENTS.find((x) => x.id === u.achievementId)
    if (a) toast.success(`🏆 Achievement unlocked: ${a.title}`)
  }
}

function safely(fn: () => Promise<void>): Promise<void> {
  return fn().catch((error) => console.warn('XP update failed', error))
}

export function onPageSaved(page: Page): Promise<void> {
  return safely(async () => {
    const rule = XP_RULES.pageWritten
    if (page.strokes.length < rule.minStrokes && page.plainText.length < rule.minChars) return
    const key = `page:${page.id}`
    if (await hasXpKey(key)) return
    if ((await xpOnDay('page_written', localDayKey())) + rule.amount > rule.dailyCap) return
    const notebook = await db.notebooks.get(page.notebookId)
    const event = await awardXp({ key, type: 'page_written', amount: rule.amount, subjectId: notebook?.subjectId ?? null })
    if (event) await announceAchievements()
  })
}

export function onDocumentAnnotated(documentId: string): Promise<void> {
  return safely(async () => {
    const key = `doc:${documentId}`
    if (await hasXpKey(key)) return
    const count = (await db.annotations.where('documentId').equals(documentId).toArray()).filter((a) => a.deletedAt === null).length
    if (count < XP_RULES.documentAnnotated.minAnnotations) return
    const doc = await db.documents.get(documentId)
    const event = await awardXp({ key, type: 'document_annotated', amount: XP_RULES.documentAnnotated.amount, subjectId: doc?.subjectId ?? null })
    if (event) await announceAchievements()
  })
}

export function onStudySetChanged(setId: string): Promise<void> {
  return safely(async () => {
    const key = `set:${setId}`
    if (await hasXpKey(key)) {
      await announceAchievements()
      return
    }
    const items = (await db.studyItems.where('setId').equals(setId).toArray()).filter((i) => i.deletedAt === null)
    if (items.length >= XP_RULES.studySetCreated.minItems) {
      const set = await db.studySets.get(setId)
      await awardXp({ key, type: 'study_set_created', amount: XP_RULES.studySetCreated.amount, subjectId: set?.subjectId ?? null })
    }
    await announceAchievements()
  })
}

export function onNotebookCreated(): Promise<void> {
  return safely(announceAchievements)
}

/** Awards session XP once per session id, plus a once-per-day study goal bonus. */
export function onSessionCompleted(session: StudySession): Promise<{ xp: number }> {
  return (async () => {
    let xp = 0
    try {
      const set = await db.studySets.get(session.setId)
      const subjectId = set?.subjectId ?? null
      const amount =
        session.mode === 'flashcards' ? flashcardSessionXp(session.answers.length) : quizSessionXp(session.totalCount, session.correctCount)
      const sessionEvent = await awardXp({
        key: `session:${session.id}`,
        type: session.mode === 'flashcards' ? 'flashcard_session' : 'quiz_session',
        amount,
        subjectId,
      })
      if (sessionEvent) {
        xp += sessionEvent.amount
        const daily = await awardXp({ key: `daily:${localDayKey()}`, type: 'daily_goal', amount: XP_RULES.dailyGoal.amount, subjectId: null })
        if (daily) xp += daily.amount
      }
      await announceAchievements()
    } catch (error) {
      console.warn('XP update failed', error)
    }
    return { xp }
  })()
}
