export const DAY_MS = 24 * 60 * 60 * 1000

export function now(): number {
  return Date.now()
}

/** Local calendar day as `YYYY-MM-DD`. Streaks are based on the user's local day, not UTC. */
export function localDayKey(at: number | Date = new Date()): string {
  const d = typeof at === 'number' ? new Date(at) : at
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a `YYYY-MM-DD` key by whole days, using local noon to dodge DST edges. */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d, 12)
  date.setDate(date.getDate() + days)
  return localDayKey(date)
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null

export function formatRelative(at: number, from: number = Date.now()): string {
  const diff = at - from
  const abs = Math.abs(diff)
  if (!rtf) return new Date(at).toLocaleString()
  if (abs < 45_000) return 'just now'
  if (abs < 45 * 60_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 22 * 3_600_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  if (abs < 7 * DAY_MS) return rtf.format(Math.round(diff / DAY_MS), 'day')
  return new Date(at).toLocaleDateString()
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
