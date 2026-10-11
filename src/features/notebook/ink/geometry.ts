import { getStroke } from 'perfect-freehand'
import type { Stroke } from '../../../db/types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Point = [number, number]

/** Constant pressure means the input device did not report pressure (mouse, most fingers). */
export const DEFAULT_PRESSURE = 0.5

export function strokePointCount(stroke: Stroke): number {
  return stroke.points.length / 3
}

function hasRealPressure(points: number[]): boolean {
  for (let i = 2; i < points.length; i += 3) if (points[i] !== DEFAULT_PRESSURE) return true
  return false
}

/** Outline polygon of a stroke (page units), produced by perfect-freehand. */
export function strokeOutline(stroke: Pick<Stroke, 'points' | 'size' | 'tool'>, complete = true): Point[] {
  const input: [number, number, number][] = []
  for (let i = 0; i < stroke.points.length; i += 3) {
    input.push([stroke.points[i]!, stroke.points[i + 1]!, stroke.points[i + 2]!])
  }
  const highlighter = stroke.tool === 'highlighter'
  return getStroke(input, {
    size: stroke.size,
    thinning: highlighter ? 0 : 0.55,
    smoothing: 0.5,
    streamline: highlighter ? 0.6 : 0.45,
    simulatePressure: !highlighter && !hasRealPressure(stroke.points),
    last: complete,
    start: { cap: !highlighter, taper: 0 },
    end: { cap: !highlighter, taper: 0 },
  }) as Point[]
}

/** SVG path data for an outline polygon (also used for PDF export). */
export function outlineToSvgPath(outline: Point[]): string {
  if (outline.length < 2) return ''
  const [first, ...rest] = outline
  let d = `M${first![0].toFixed(2)} ${first![1].toFixed(2)}`
  // Quadratic smoothing between midpoints gives smooth edges without many points.
  for (let i = 0; i < rest.length - 1; i++) {
    const [x0, y0] = rest[i]!
    const [x1, y1] = rest[i + 1]!
    d += ` Q${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`
  }
  const last = rest[rest.length - 1]
  if (last) d += ` L${last[0].toFixed(2)} ${last[1].toFixed(2)}`
  return `${d} Z`
}

const bboxCache = new WeakMap<Stroke, Rect>()

export function strokeBounds(stroke: Stroke): Rect {
  const cached = bboxCache.get(stroke)
  if (cached) return cached
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < stroke.points.length; i += 3) {
    const x = stroke.points[i]!
    const y = stroke.points[i + 1]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const pad = stroke.size / 2
  const rect = { x: minX - pad, y: minY - pad, w: maxX - minX + stroke.size, h: maxY - minY + stroke.size }
  bboxCache.set(stroke, rect)
  return rect
}

export function unionBounds(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function rectContains(r: Rect, x: number, y: number, margin = 0): boolean {
  return x >= r.x - margin && x <= r.x + r.w + margin && y >= r.y - margin && y <= r.y + r.h + margin
}

/** Squared distance from point p to segment ab. */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

/** True if a circle (eraser) at (x, y) with `radius` touches the stroke. */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const reach = radius + stroke.size / 2
  if (!rectContains(strokeBounds(stroke), x, y, radius)) return false
  const pts = stroke.points
  if (pts.length === 3) return (pts[0]! - x) ** 2 + (pts[1]! - y) ** 2 <= reach * reach
  for (let i = 0; i + 3 < pts.length; i += 3) {
    if (distToSegmentSq(x, y, pts[i]!, pts[i + 1]!, pts[i + 3]!, pts[i + 4]!) <= reach * reach) return true
  }
  return false
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A stroke is lasso-selected when at least half of its points are inside the lasso. */
export function strokeInLasso(stroke: Stroke, lasso: Point[]): boolean {
  if (lasso.length < 3) return false
  const n = strokePointCount(stroke)
  let inside = 0
  for (let i = 0; i < stroke.points.length; i += 3) {
    if (pointInPolygon(stroke.points[i]!, stroke.points[i + 1]!, lasso)) inside++
  }
  return inside * 2 >= n
}

export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  const points = stroke.points.slice()
  for (let i = 0; i < points.length; i += 3) {
    points[i] = round2(points[i]! + dx)
    points[i + 1] = round2(points[i + 1]! + dy)
  }
  return { ...stroke, points }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Drops points closer than `minDist` to the previous kept point. Reduces stored size
 * substantially for slow strokes without visible change.
 */
export function simplifyPoints(points: number[], minDist = 0.6): number[] {
  if (points.length <= 6) return points
  const out = [points[0]!, points[1]!, points[2]!]
  const minSq = minDist * minDist
  for (let i = 3; i < points.length - 3; i += 3) {
    const lx = out[out.length - 3]!
    const ly = out[out.length - 2]!
    if ((points[i]! - lx) ** 2 + (points[i + 1]! - ly) ** 2 >= minSq) out.push(points[i]!, points[i + 1]!, points[i + 2]!)
  }
  const n = points.length
  out.push(points[n - 3]!, points[n - 2]!, points[n - 1]!)
  return out
}
