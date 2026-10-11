import type { PageContent, Stroke, TextBlock } from '../../db/types'
import { translateStroke } from './ink/geometry'

/**
 * Per-page editing state with undo/redo. Content objects are immutable and share structure,
 * so each history entry costs only an array of references, not a deep copy.
 */
export interface PageEditorState {
  content: PageContent
  past: PageContent[]
  future: PageContent[]
  /** Consecutive edits with the same key (typing in one text box) share one undo step. */
  coalesceKey: string | null
}

export const HISTORY_LIMIT = 100

export type EditorAction =
  | { type: 'addStroke'; stroke: Stroke }
  | { type: 'removeStrokes'; ids: string[] }
  | { type: 'moveStrokes'; ids: string[]; dx: number; dy: number }
  | { type: 'recolorStrokes'; ids: string[]; color: string }
  | { type: 'duplicateStrokes'; ids: string[]; newIds: string[]; dx: number; dy: number }
  | { type: 'addText'; block: TextBlock }
  | { type: 'editText'; id: string; patch: Partial<Omit<TextBlock, 'id'>> }
  | { type: 'removeText'; id: string }
  | { type: 'clearPage' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'endCoalesce' }

export function initEditorState(content: PageContent): PageEditorState {
  return { content, past: [], future: [], coalesceKey: null }
}

function commit(state: PageEditorState, content: PageContent, coalesceKey: string | null = null): PageEditorState {
  if (content === state.content) return state
  if (coalesceKey && coalesceKey === state.coalesceKey) {
    // Same typing burst: replace content but keep the existing undo point.
    return { ...state, content, future: [] }
  }
  const past = [...state.past, state.content]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { content, past, future: [], coalesceKey }
}

export function editorReducer(state: PageEditorState, action: EditorAction): PageEditorState {
  const { content } = state
  switch (action.type) {
    case 'addStroke':
      return commit(state, { ...content, strokes: [...content.strokes, action.stroke] })

    case 'removeStrokes': {
      if (action.ids.length === 0) return state
      const ids = new Set(action.ids)
      const strokes = content.strokes.filter((s) => !ids.has(s.id))
      if (strokes.length === content.strokes.length) return state
      return commit(state, { ...content, strokes })
    }

    case 'moveStrokes': {
      if (action.ids.length === 0 || (action.dx === 0 && action.dy === 0)) return state
      const ids = new Set(action.ids)
      return commit(state, {
        ...content,
        strokes: content.strokes.map((s) => (ids.has(s.id) ? translateStroke(s, action.dx, action.dy) : s)),
      })
    }

    case 'recolorStrokes': {
      const ids = new Set(action.ids)
      return commit(state, {
        ...content,
        strokes: content.strokes.map((s) => (ids.has(s.id) ? { ...s, color: action.color } : s)),
      })
    }

    case 'duplicateStrokes': {
      const copies: Stroke[] = []
      action.ids.forEach((id, i) => {
        const original = content.strokes.find((s) => s.id === id)
        const newId = action.newIds[i]
        if (original && newId) copies.push({ ...translateStroke(original, action.dx, action.dy), id: newId })
      })
      if (copies.length === 0) return state
      return commit(state, { ...content, strokes: [...content.strokes, ...copies] })
    }

    case 'addText':
      return commit(state, { ...content, textBlocks: [...content.textBlocks, action.block] })

    case 'editText': {
      const index = content.textBlocks.findIndex((b) => b.id === action.id)
      if (index < 0) return state
      const textBlocks = content.textBlocks.slice()
      textBlocks[index] = { ...textBlocks[index]!, ...action.patch }
      return commit(state, { ...content, textBlocks }, `text:${action.id}`)
    }

    case 'removeText': {
      const textBlocks = content.textBlocks.filter((b) => b.id !== action.id)
      if (textBlocks.length === content.textBlocks.length) return state
      return commit(state, { ...content, textBlocks })
    }

    case 'clearPage':
      if (content.strokes.length === 0 && content.textBlocks.length === 0) return state
      return commit(state, { strokes: [], textBlocks: [] })

    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return { content: previous, past: state.past.slice(0, -1), future: [content, ...state.future], coalesceKey: null }
    }

    case 'redo': {
      const [next, ...rest] = state.future
      if (!next) return state
      return { content: next, past: [...state.past, content], future: rest, coalesceKey: null }
    }

    case 'endCoalesce':
      return state.coalesceKey ? { ...state, coalesceKey: null } : state
  }
}
