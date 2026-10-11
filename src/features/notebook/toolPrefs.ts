import { useState } from 'react'
import type { EditorTool } from './ink/InkCanvas'

export const PEN_COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#ea580c'] as const
export const HIGHLIGHTER_COLORS = ['#facc15', '#4ade80', '#f472b6', '#60a5fa', '#fb923c'] as const
export const PEN_SIZES = [1.5, 2.5, 4, 7] as const
export const HIGHLIGHTER_SIZES = [12, 18, 28] as const
export const ERASER_SIZES = [10, 22, 44] as const

export interface ToolPrefs {
  tool: EditorTool
  penColor: string
  penSize: number
  highlighterColor: string
  highlighterSize: number
  eraserSize: number
}

const DEFAULTS: ToolPrefs = {
  tool: 'pen',
  penColor: PEN_COLORS[0],
  penSize: PEN_SIZES[1],
  highlighterColor: HIGHLIGHTER_COLORS[0],
  highlighterSize: HIGHLIGHTER_SIZES[1],
  eraserSize: ERASER_SIZES[1],
}

const KEY = 'notivra.toolPrefs'

function load(): ToolPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<ToolPrefs>
    return { ...DEFAULTS, ...parsed, tool: parsed.tool === 'text' || parsed.tool === 'lasso' ? 'pen' : (parsed.tool ?? 'pen') }
  } catch {
    return DEFAULTS
  }
}

/** Per-device pen/highlighter preferences (a convenience; losing them is harmless). */
export function useToolPrefs() {
  const [prefs, setPrefs] = useState<ToolPrefs>(load)
  const update = (patch: Partial<ToolPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }
  return [prefs, update] as const
}
