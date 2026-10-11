import type { Annotation, AnnotationShape } from '../../db/types'
import { distToSegmentSq } from '../notebook/ink/geometry'

export type PdfTool = 'pan' | 'select' | 'pen' | 'highlighter' | 'highlight' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'eraser'

export interface Bounds {
  x1: number
  y1: number
  x2: number
  y2: number
}

const TEXT_LINE_HEIGHT = 1.2
const AVG_CHAR_WIDTH = 0.55

/** Axis-aligned bounds in PDF user space. */
export function shapeBounds(shape: AnnotationShape): Bounds {
  switch (shape.kind) {
    case 'ink': {
      let x1 = Infinity
      let y1 = Infinity
      let x2 = -Infinity
      let y2 = -Infinity
      for (let i = 0; i + 1 < shape.points.length; i += 2) {
        x1 = Math.min(x1, shape.points[i]!)
        x2 = Math.max(x2, shape.points[i]!)
        y1 = Math.min(y1, shape.points[i + 1]!)
        y2 = Math.max(y2, shape.points[i + 1]!)
      }
      const p = shape.width / 2
      return { x1: x1 - p, y1: y1 - p, x2: x2 + p, y2: y2 + p }
    }
    case 'highlight':
    case 'rect':
    case 'ellipse': {
      const [ax, ay, bx, by] = shape.rect
      return { x1: Math.min(ax, bx), y1: Math.min(ay, by), x2: Math.max(ax, bx), y2: Math.max(ay, by) }
    }
    case 'line':
    case 'arrow':
      return {
        x1: Math.min(shape.from[0], shape.to[0]),
        y1: Math.min(shape.from[1], shape.to[1]),
        x2: Math.max(shape.from[0], shape.to[0]),
        y2: Math.max(shape.from[1], shape.to[1]),
      }
    case 'text': {
      const lines = shape.text.split('\n')
      const longest = Math.max(1, ...lines.map((l) => l.length))
      return {
        x1: shape.x,
        y1: shape.y - lines.length * shape.fontSize * TEXT_LINE_HEIGHT,
        x2: shape.x + longest * shape.fontSize * AVG_CHAR_WIDTH,
        y2: shape.y,
      }
    }
  }
}

/** True when point (x, y) — PDF user space — touches the annotation within `tolerance`. */
export function hitTest(a: Annotation, x: number, y: number, tolerance: number): boolean {
  const s = a.shape
  const b = shapeBounds(s)
  if (x < b.x1 - tolerance || x > b.x2 + tolerance || y < b.y1 - tolerance || y > b.y2 + tolerance) return false
  switch (s.kind) {
    case 'ink': {
      const reach = (tolerance + s.width / 2) ** 2
      if (s.points.length === 2) return (s.points[0]! - x) ** 2 + (s.points[1]! - y) ** 2 <= reach
      for (let i = 0; i + 3 < s.points.length; i += 2) {
        if (distToSegmentSq(x, y, s.points[i]!, s.points[i + 1]!, s.points[i + 2]!, s.points[i + 3]!) <= reach) return true
      }
      return false
    }
    case 'line':
    case 'arrow':
      return distToSegmentSq(x, y, s.from[0], s.from[1], s.to[0], s.to[1]) <= (tolerance + s.width / 2) ** 2
    default:
      return true // inside the (expanded) bounds
  }
}

export function translateShape(shape: AnnotationShape, dx: number, dy: number): AnnotationShape {
  const r = (n: number) => Math.round(n * 100) / 100
  switch (shape.kind) {
    case 'ink':
      return { ...shape, points: shape.points.map((v, i) => r(v + (i % 2 === 0 ? dx : dy))) }
    case 'highlight':
    case 'rect':
    case 'ellipse': {
      const [a, b, c, d] = shape.rect
      return { ...shape, rect: [r(a + dx), r(b + dy), r(c + dx), r(d + dy)] }
    }
    case 'line':
    case 'arrow':
      return { ...shape, from: [r(shape.from[0] + dx), r(shape.from[1] + dy)], to: [r(shape.to[0] + dx), r(shape.to[1] + dy)] }
    case 'text':
      return { ...shape, x: r(shape.x + dx), y: r(shape.y + dy) }
  }
}

/** Drops points closer than `minDist` (PDF points) to keep stored ink compact. */
export function simplifyInk(points: number[], minDist = 0.4): number[] {
  if (points.length <= 4) return points
  const out = [points[0]!, points[1]!]
  for (let i = 2; i < points.length - 2; i += 2) {
    const lx = out[out.length - 2]!
    const ly = out[out.length - 1]!
    if ((points[i]! - lx) ** 2 + (points[i + 1]! - ly) ** 2 >= minDist * minDist) out.push(points[i]!, points[i + 1]!)
  }
  out.push(points[points.length - 2]!, points[points.length - 1]!)
  return out
}

export const TOOL_DEFAULTS: Record<'pen' | 'highlighter' | 'shape' | 'text', { width: number; opacity: number }> = {
  pen: { width: 1.5, opacity: 1 },
  highlighter: { width: 12, opacity: 0.35 },
  shape: { width: 2, opacity: 1 },
  text: { width: 14, opacity: 1 }, // width = font size for text
}
