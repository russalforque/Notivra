import { db } from '../../db/database'
import type { Achievement } from '../../db/types'

/**
 * Achievement catalog. Each achievement has one explicit, measurable criterion
 * (`metric >= threshold`) evaluated from stored data — never from client-side counters
 * that could drift or be inflated by repeated clicks.
 */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-notebook', title: 'Fresh Pages', description: 'Create your first notebook.', icon: 'notebook', metric: 'notebooksCreated', threshold: 1 },
  { id: 'pages-10', title: 'Prolific Scribe', description: 'Write on 10 notebook pages.', icon: 'pen', metric: 'pagesWritten', threshold: 10 },
  { id: 'first-annotation', title: 'Margin Notes', description: 'Annotate your first PDF.', icon: 'highlighter', metric: 'documentsAnnotated', threshold: 1 },
  { id: 'first-set', title: 'Deck Builder', description: 'Create your first study set.', icon: 'layers', metric: 'studySetsCreated', threshold: 1 },
  { id: 'first-session', title: 'First Steps', description: 'Complete your first study session.', icon: 'footprints', metric: 'sessionsCompleted', threshold: 1 },
  { id: 'sessions-25', title: 'Study Habit', description: 'Complete 25 study sessions.', icon: 'repeat', metric: 'sessionsCompleted', threshold: 25 },
  { id: 'cards-100', title: 'Card Shark', description: 'Review 100 flashcards.', icon: 'copy', metric: 'cardsReviewed', threshold: 100 },
  { id: 'cards-1000', title: 'Memory Palace', description: 'Review 1,000 flashcards.', icon: 'brain', metric: 'cardsReviewed', threshold: 1000 },
  { id: 'perfect-quiz', title: 'Flawless', description: 'Score 100% on a quiz with at least 5 questions.', icon: 'target', metric: 'perfectQuizzes', threshold: 1 },
  { id: 'streak-3', title: 'Warming Up', description: 'Study 3 days in a row.', icon: 'flame', metric: 'streak', threshold: 3 },
  { id: 'streak-7', title: 'On Fire', description: 'Study 7 days in a row.', icon: 'flame', metric: 'streak', threshold: 7 },
  { id: 'streak-30', title: 'Unstoppable', description: 'Study 30 days in a row.', icon: 'trophy', metric: 'streak', threshold: 30 },
  { id: 'xp-1000', title: 'Rising Scholar', description: 'Earn 1,000 XP.', icon: 'star', metric: 'totalXp', threshold: 1000 },
  { id: 'xp-5000', title: 'Honor Roll', description: 'Earn 5,000 XP.', icon: 'award', metric: 'totalXp', threshold: 5000 },
]

/** Mirrors the code catalog into IndexedDB (idempotent; safe on every start). */
export async function seedAchievementCatalog(): Promise<void> {
  await db.achievements.bulkPut(ACHIEVEMENTS)
}
