/**
 * XP business rules. Centralized and declarative so they can be tuned (or moved to remote
 * config) without touching UI code. Rewards are tied to meaningful, verifiable outcomes;
 * every award has an idempotency key so retries and repeated clicks never double-count.
 */
export const XP_RULES = {
  flashcardSession: { base: 10, perItem: 1, max: 40, minItems: 5 },
  quizSession: { base: 10, perCorrect: 2, max: 50, minItems: 3 },
  dailyGoal: { amount: 15 },
  pageWritten: { amount: 5, minStrokes: 20, minChars: 100, dailyCap: 50 },
  documentAnnotated: { amount: 5, minAnnotations: 5 },
  studySetCreated: { amount: 5, minItems: 5 },
} as const

/** Total XP required to reach `level` (level 1 starts at 0). 100, 300, 600, 1000, … */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) * level
}

export function levelForXp(totalXp: number): { level: number; current: number; next: number; progress: number } {
  let level = 1
  while (xpForLevel(level + 1) <= totalXp) level++
  const current = xpForLevel(level)
  const next = xpForLevel(level + 1)
  return { level, current, next, progress: (totalXp - current) / (next - current) }
}

export function flashcardSessionXp(itemsReviewed: number): number {
  const r = XP_RULES.flashcardSession
  if (itemsReviewed < r.minItems) return 0
  return Math.min(r.max, r.base + itemsReviewed * r.perItem)
}

export function quizSessionXp(total: number, correct: number): number {
  const r = XP_RULES.quizSession
  if (total < r.minItems) return 0
  return Math.min(r.max, r.base + correct * r.perCorrect)
}
