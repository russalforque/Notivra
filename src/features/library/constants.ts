import type { PageTemplate } from '../../db/types'

/** Subject / notebook palette. Chosen to stay readable with white text in both themes. */
export const PALETTE = [
  '#4f46e5', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#64748b', // slate
] as const

export const PAGE_TEMPLATES: { id: PageTemplate; label: string }[] = [
  { id: 'lined', label: 'Lined' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'blank', label: 'Blank' },
]

/** Logical page size in page units (A4 at 96 dpi). Strokes are stored in these units. */
export const PAGE_WIDTH = 794
export const PAGE_HEIGHT = 1123

/** Items stay in the trash this long before being permanently removed. */
export const TRASH_RETENTION_DAYS = 30
