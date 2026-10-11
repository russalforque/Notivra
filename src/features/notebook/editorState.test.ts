import { describe, expect, it } from 'vitest'
import type { Stroke } from '../../db/types'
import { HISTORY_LIMIT, editorReducer, initEditorState } from './editorState'

const stroke = (id: string, x = 0): Stroke => ({ id, tool: 'pen', color: '#000000', size: 2, points: [x, 0, 0.5, x + 10, 10, 0.5] })

describe('editor reducer', () => {
  it('supports undo and redo of strokes', () => {
    let s = initEditorState({ strokes: [], textBlocks: [] })
    s = editorReducer(s, { type: 'addStroke', stroke: stroke('a') })
    s = editorReducer(s, { type: 'addStroke', stroke: stroke('b') })
    expect(s.content.strokes.map((x) => x.id)).toEqual(['a', 'b'])
    s = editorReducer(s, { type: 'undo' })
    expect(s.content.strokes.map((x) => x.id)).toEqual(['a'])
    s = editorReducer(s, { type: 'redo' })
    expect(s.content.strokes.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('clears redo history after a new edit', () => {
    let s = initEditorState({ strokes: [], textBlocks: [] })
    s = editorReducer(s, { type: 'addStroke', stroke: stroke('a') })
    s = editorReducer(s, { type: 'undo' })
    s = editorReducer(s, { type: 'addStroke', stroke: stroke('c') })
    expect(s.future).toHaveLength(0)
    expect(editorReducer(s, { type: 'redo' })).toBe(s)
  })

  it('moves strokes without mutating the original', () => {
    const original = stroke('a')
    let s = initEditorState({ strokes: [original], textBlocks: [] })
    s = editorReducer(s, { type: 'moveStrokes', ids: ['a'], dx: 5, dy: 7 })
    expect(s.content.strokes[0]?.points.slice(0, 2)).toEqual([5, 7])
    expect(original.points.slice(0, 2)).toEqual([0, 0])
    s = editorReducer(s, { type: 'undo' })
    expect(s.content.strokes[0]).toBe(original)
  })

  it('coalesces typing into a single undo step per text box', () => {
    let s = initEditorState({ strokes: [], textBlocks: [] })
    s = editorReducer(s, { type: 'addText', block: { id: 't', x: 0, y: 0, width: 100, text: '', fontSize: 16, color: '#000000' } })
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) s = editorReducer(s, { type: 'editText', id: 't', patch: { text } })
    expect(s.content.textBlocks[0]?.text).toBe('Hello')
    s = editorReducer(s, { type: 'undo' })
    expect(s.content.textBlocks[0]?.text).toBe('')
  })

  it('caps history length', () => {
    let s = initEditorState({ strokes: [], textBlocks: [] })
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = editorReducer(s, { type: 'addStroke', stroke: stroke(String(i)) })
    expect(s.past).toHaveLength(HISTORY_LIMIT)
  })

  it('is a no-op (same reference) for edits that change nothing', () => {
    const s = initEditorState({ strokes: [stroke('a')], textBlocks: [] })
    expect(editorReducer(s, { type: 'removeStrokes', ids: ['zzz'] })).toBe(s)
    expect(editorReducer(s, { type: 'moveStrokes', ids: ['a'], dx: 0, dy: 0 })).toBe(s)
  })
})
