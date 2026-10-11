import type { PageTemplate, Stroke } from '../../../db/types'
import { outlineToSvgPath, strokeOutline } from './geometry'

export const PAPER_COLOR = '#fffef9'
const LINE_COLOR = '#c7d3ec'
const MARGIN_COLOR = '#f2b8b8'
export const LINE_SPACING = 32
export const GRID_SPACING = 24
export const HIGHLIGHTER_ALPHA = 0.35

const pathCache = new WeakMap<Stroke, Path2D>()

/** Path2D objects are cached per (immutable) stroke object, so redraws are cheap. */
function strokePath(stroke: Stroke): Path2D {
  let path = pathCache.get(stroke)
  if (!path) {
    path = new Path2D(outlineToSvgPath(strokeOutline(stroke)))
    pathCache.set(stroke, path)
  }
  return path
}

export function drawTemplate(ctx: CanvasRenderingContext2D, template: PageTemplate, width: number, height: number): void {
  ctx.fillStyle = PAPER_COLOR
  ctx.fillRect(0, 0, width, height)
  ctx.lineWidth = 1
  if (template === 'lined') {
    ctx.strokeStyle = LINE_COLOR
    ctx.beginPath()
    for (let y = LINE_SPACING * 3; y < height - 8; y += LINE_SPACING) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(width, y + 0.5)
    }
    ctx.stroke()
    ctx.strokeStyle = MARGIN_COLOR
    ctx.beginPath()
    ctx.moveTo(80.5, 0)
    ctx.lineTo(80.5, height)
    ctx.stroke()
  } else if (template === 'grid') {
    ctx.strokeStyle = '#dde4f3'
    ctx.beginPath()
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, height)
    }
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(width, y + 0.5)
    }
    ctx.stroke()
  } else if (template === 'dotted') {
    ctx.fillStyle = '#b3c2e3'
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
        ctx.beginPath()
        ctx.arc(x, y, 1.1, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, offset?: { dx: number; dy: number }): void {
  ctx.save()
  if (offset) ctx.translate(offset.dx, offset.dy)
  ctx.fillStyle = stroke.color
  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA
    ctx.globalCompositeOperation = 'multiply'
  }
  ctx.fill(strokePath(stroke))
  ctx.restore()
}

/** Draws an in-progress stroke without caching (its points change every frame). */
export function drawLiveStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const path = new Path2D(outlineToSvgPath(strokeOutline(stroke, false)))
  ctx.save()
  ctx.fillStyle = stroke.color
  if (stroke.tool === 'highlighter') ctx.globalAlpha = HIGHLIGHTER_ALPHA
  ctx.fill(path)
  ctx.restore()
}

export interface RenderOptions {
  template: PageTemplate
  width: number
  height: number
  strokes: Stroke[]
  /** Stroke ids to skip (being erased or dragged). */
  hidden?: Set<string>
}

export function renderPage(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  drawTemplate(ctx, opts.template, opts.width, opts.height)
  for (const s of opts.strokes) {
    if (opts.hidden?.has(s.id)) continue
    drawStroke(ctx, s)
  }
}

/**
 * Pixel ratio for a canvas showing `cssWidth × cssHeight`, capped so very large zoom levels
 * don't allocate huge bitmaps (mobile browsers fail silently above ~16M pixels).
 */
export function canvasPixelRatio(cssWidth: number, cssHeight: number): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const maxPixels = 12_000_000
  const maxSide = 8192
  const byArea = Math.sqrt(maxPixels / Math.max(1, cssWidth * cssHeight))
  const bySide = maxSide / Math.max(cssWidth, cssHeight, 1)
  return Math.max(0.5, Math.min(dpr, byArea, bySide))
}
