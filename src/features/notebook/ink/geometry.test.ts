import { describe, expect, it } from 'vitest'
import type { Stroke } from '../../../db/types'
import { pointInPolygon, simplifyPoints, strokeBounds, strokeHit, strokeInLasso, strokeOutline, type Point } from './geometry'

const line: Stroke = { id: 's', tool: 'pen', color: '#000000', size: 4, points: [0, 0, 0.5, 100, 0, 0.5] }

describe('ink geometry', () => {
  it('hit-tests strokes with the eraser radius plus stroke width', () => {
    expect(strokeHit(line, 50, 3, 2)).toBe(true) // 3 <= 2 + 2
    expect(strokeHit(line, 50, 10, 2)).toBe(false)
    expect(strokeHit(line, 150, 0, 2)).toBe(false)
  })

  it('computes padded bounds', () => {
    expect(strokeBounds(line)).toEqual({ x: -2, y: -2, w: 104, h: 4 })
  })

  it('selects strokes that are mostly inside a lasso', () => {
    const square: Point[] = [
      [-10, -10],
      [60, -10],
      [60, 10],
      [-10, 10],
    ]
    expect(pointInPolygon(5, 5, square)).toBe(true)
    expect(pointInPolygon(80, 5, square)).toBe(false)
    const mostlyInside: Stroke = { ...line, points: [0, 0, 0.5, 20, 0, 0.5, 40, 0, 0.5, 100, 0, 0.5] }
    expect(strokeInLasso(mostlyInside, square)).toBe(true)
    expect(strokeInLasso(line, square.map(([x, y]) => [x + 200, y] as Point))).toBe(false)
  })

  it('produces a closed outline for single-point dots', () => {
    const dot: Stroke = { ...line, points: [10, 10, 0.5] }
    expect(strokeOutline(dot).length).toBeGreaterThan(3)
  })

  it('simplifies dense points but keeps endpoints', () => {
    const dense: number[] = []
    for (let i = 0; i <= 100; i++) dense.push(i * 0.1, 0, 0.5)
    const simplified = simplifyPoints(dense, 1)
    expect(simplified.length).toBeLessThan(dense.length / 3)
    expect(simplified.slice(0, 3)).toEqual([0, 0, 0.5])
    expect(simplified.slice(-3)).toEqual(dense.slice(-3))
    expect(simplified.length % 3).toBe(0)
  })
})
