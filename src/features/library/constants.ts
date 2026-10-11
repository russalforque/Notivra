import type { PageTemplate } from '../../db/types'

/**
 * Subject / notebook palette, in fixed order (new subjects take the next slot).
 * Validated with the dataviz palette checker (light): lightness band, chroma floor and
 * normal-vision separation pass; adjacent CVD ΔE ≥ 6.9, so charts always pair these colours
 * with direct text labels and never rely on colour alone.
 */
export const PALETTE = [
  '#4f46e5', // indigo
  '#f59e0b', // amber
  '#0d9488', // teal
  '#ec4899', // pink
  '#0ea5e9', // sky
  '#ef4444', // red
  '#8b5cf6', // violet
  '#10b981', // emerald
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
