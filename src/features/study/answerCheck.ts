/** Normalizes free-text answers: case, accents, punctuation, articles and spacing. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

/**
 * Short-answer check. Accepts exact matches after normalization, plus small typos on longer
 * answers (≤1 edit for 5–9 chars, ≤2 for 10+). Numbers must match exactly.
 */
export function isShortAnswerCorrect(response: string, answer: string, accepted: string[] = []): boolean {
  const r = normalizeAnswer(response)
  if (!r) return false
  for (const candidate of [answer, ...accepted]) {
    const c = normalizeAnswer(candidate)
    if (!c) continue
    if (r === c) return true
    if (/\d/.test(c)) continue
    const allowed = c.length >= 10 ? 2 : c.length >= 5 ? 1 : 0
    if (allowed > 0 && levenshtein(r, c) <= allowed) return true
  }
  return false
}
