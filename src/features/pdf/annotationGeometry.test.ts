import { describe, expect, it } from 'vitest'
import type { Annotation, AnnotationShape } from '../../db/types'
import { hitTest, shapeBounds, simplifyInk, translateShape } from './annotationGeometry'

const ann = (shape: AnnotationShape): Annotation => ({
  id: 'a',
  ownerId: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  rev: 1,
  serverRev: null,
  syncStatus: 'pending',
  documentId: 'd',
  pageIndex: 0,
  color: '#000000',
  opacity: 1,
  shape,
})

describe('annotation geometry', () => {
  it('hit-tests ink along its segments only', () => {
    const a = ann({ kind: 'ink', points: [0, 0, 100, 100], width: 2 })
    expect(hitTest(a, 50, 50, 3)).toBe(true)
    expect(hitTest(a, 50, 0, 3)).toBe(false) // inside bounds but far from the line
  })

  it('hit-tests boxes by area', () => {
    const a = ann({ kind: 'highlight', rect: [10, 10, 60, 30] })
    expect(hitTest(a, 30, 20, 2)).toBe(true)
    expect(hitTest(a, 80, 20, 2)).toBe(false)
  })

  it('computes text bounds downward from the anchor (PDF y grows upward)', () => {
    const b = shapeBounds({ kind: 'text', x: 100, y: 500, text: 'ab\ncd', fontSize: 10 })
    expect(b.y2).toBe(500)
    expect(b.y1).toBe(476)
  })

  it('translates every shape kind', () => {
    expect(translateShape({ kind: 'ink', points: [1, 2, 3, 4], width: 1 }, 10, 20)).toMatchObject({ points: [11, 22, 13, 24] })
    expect(translateShape({ kind: 'rect', rect: [0, 0, 5, 5], width: 1 }, 1, 1)).toMatchObject({ rect: [1, 1, 6, 6] })
    expect(translateShape({ kind: 'arrow', from: [0, 0], to: [1, 1], width: 1 }, 1, 2)).toMatchObject({ from: [1, 2], to: [2, 3] })
    expect(translateShape({ kind: 'text', x: 0, y: 0, text: 'x', fontSize: 9 }, 3, 4)).toMatchObject({ x: 3, y: 4 })
  })

  it('simplifies ink while keeping endpoints', () => {
    const pts: number[] = []
    for (let i = 0; i <= 50; i++) pts.push(i * 0.05, 0)
    const out = simplifyInk(pts, 0.5)
    expect(out.length).toBeLessThan(pts.length)
    expect(out.slice(0, 2)).toEqual([0, 0])
    expect(out.slice(-2)).toEqual(pts.slice(-2))
  })
})
