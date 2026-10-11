import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PageTemplate, Stroke } from '../../../db/types'
import { newId } from '../../../lib/ids'
import {
  DEFAULT_PRESSURE,
  round2,
  simplifyPoints,
  strokeBounds,
  strokeHit,
  strokeInLasso,
  unionBounds,
  rectContains,
  type Point,
  type Rect,
} from './geometry'
import { canvasPixelRatio, drawLiveStroke, drawStroke, renderPage } from './render'

export type EditorTool = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'text' | 'pan'

export interface InkCanvasProps {
  pageWidth: number
  pageHeight: number
  cssWidth: number
  template: PageTemplate
  strokes: Stroke[]
  tool: EditorTool
  brush: { color: string; size: number }
  eraserSize: number
  fingerDrawing: boolean
  selection: string[]
  onStroke: (stroke: Stroke) => void
  onErase: (ids: string[]) => void
  onSelectionChange: (ids: string[]) => void
  onMoveSelection: (dx: number, dy: number) => void
  onTextAt: (x: number, y: number) => void
  onPan: (dx: number, dy: number) => void
  label: string
}

type Gesture =
  | { kind: 'draw'; pointerId: number; points: number[]; pointerType: string }
  | { kind: 'erase'; pointerId: number; hits: Set<string> }
  | { kind: 'lasso'; pointerId: number; points: Point[] }
  | { kind: 'move'; pointerId: number; startX: number; startY: number; dx: number; dy: number }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }

const DRAW_TOOLS: EditorTool[] = ['pen', 'highlighter', 'eraser', 'lasso']

/**
 * Two stacked canvases: `base` holds the template and committed strokes, `live` shows the
 * stroke being drawn, lasso, selection box and eraser cursor. Pointer handling writes to
 * refs and draws imperatively — React does not re-render while the user is writing.
 */
export function InkCanvas(props: InkCanvasProps) {
  const { pageWidth, pageHeight, cssWidth, template, strokes, tool, selection, fingerDrawing } = props
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const touches = useRef(new Set<number>())
  const frame = useRef<number | null>(null)
  const hover = useRef<{ x: number; y: number } | null>(null)
  const propsRef = useRef(props)
  const [penSeen, setPenSeen] = useState(false)
  const [hidden, setHidden] = useState<Set<string> | null>(null)
  const rendered = useRef<{ strokes: Stroke[]; template: PageTemplate; width: number; hidden: Set<string> | null } | null>(null)

  useLayoutEffect(() => {
    propsRef.current = props
  })

  const cssHeight = (cssWidth * pageHeight) / pageWidth
  const scale = cssWidth / pageWidth
  const ratio = canvasPixelRatio(cssWidth, cssHeight)

  // ── Canvas sizing ──
  useLayoutEffect(() => {
    for (const canvas of [baseRef.current, liveRef.current]) {
      if (!canvas) continue
      canvas.width = Math.round(cssWidth * ratio)
      canvas.height = Math.round(cssHeight * ratio)
    }
    rendered.current = null // Resizing clears the bitmap.
  }, [cssWidth, cssHeight, ratio])

  const ctxFor = (canvas: HTMLCanvasElement | null) => {
    const ctx = canvas?.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0)
    return ctx
  }

  // ── Base layer: incremental when strokes were only appended ──
  useLayoutEffect(() => {
    const ctx = ctxFor(baseRef.current)
    if (!ctx) return
    const prev = rendered.current
    const appendOnly =
      prev &&
      prev.template === template &&
      prev.width === cssWidth &&
      prev.hidden === hidden &&
      strokes.length >= prev.strokes.length &&
      prev.strokes.every((s, i) => strokes[i] === s)
    if (appendOnly) {
      for (let i = prev.strokes.length; i < strokes.length; i++) drawStroke(ctx, strokes[i]!)
    } else {
      renderPage(ctx, { template, width: pageWidth, height: pageHeight, strokes, hidden: hidden ?? undefined })
    }
    rendered.current = { strokes, template, width: cssWidth, hidden }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, template, cssWidth, ratio, hidden, pageWidth, pageHeight])

  // ── Live layer ──
  const selectionBounds = (): Rect | null => {
    const ids = new Set(propsRef.current.selection)
    return unionBounds(propsRef.current.strokes.filter((s) => ids.has(s.id)).map(strokeBounds))
  }

  const drawLive = () => {
    frame.current = null
    const ctx = ctxFor(liveRef.current)
    if (!ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.restore()
    const p = propsRef.current
    const g = gesture.current
    const lineWidth = 1.5 / scale

    if (g?.kind === 'draw' && g.points.length >= 3) {
      drawLiveStroke(ctx, { id: 'live', tool: p.tool === 'highlighter' ? 'highlighter' : 'pen', color: p.brush.color, size: p.brush.size, points: g.points })
    }
    if (g?.kind === 'lasso' && g.points.length > 1) {
      ctx.save()
      ctx.setLineDash([6 / scale, 5 / scale])
      ctx.strokeStyle = '#4f46e5'
      ctx.lineWidth = lineWidth
      ctx.fillStyle = 'rgba(79,70,229,0.06)'
      ctx.beginPath()
      g.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    if (p.selection.length > 0 && p.tool === 'lasso') {
      const offset = g?.kind === 'move' ? { dx: g.dx, dy: g.dy } : undefined
      if (offset) {
        const ids = new Set(p.selection)
        for (const s of p.strokes) if (ids.has(s.id)) drawStroke(ctx, s, offset)
      }
      const b = selectionBounds()
      if (b) {
        ctx.save()
        ctx.setLineDash([6 / scale, 4 / scale])
        ctx.strokeStyle = '#4f46e5'
        ctx.lineWidth = lineWidth
        ctx.strokeRect(b.x - 6 + (offset?.dx ?? 0), b.y - 6 + (offset?.dy ?? 0), b.w + 12, b.h + 12)
        ctx.restore()
      }
    }
    if (p.tool === 'eraser' && hover.current) {
      ctx.save()
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      ctx.arc(hover.current.x, hover.current.y, p.eraserSize / 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  const requestLive = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(drawLive)
  }

  useEffect(() => {
    requestLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, tool, strokes, cssWidth, ratio])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  // ── Pointer handling ──
  const toPage = (e: { clientX: number; clientY: number }) => {
    const rect = liveRef.current!.getBoundingClientRect()
    return {
      x: round2(((e.clientX - rect.left) / rect.width) * pageWidth),
      y: round2(((e.clientY - rect.top) / rect.height) * pageHeight),
    }
  }

  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' && e.pressure > 0 ? round2(e.pressure) : DEFAULT_PRESSURE)

  /** Fingers write only if allowed and no stylus has been used in this session (palm rejection). */
  const touchWrites = fingerDrawing && !penSeen

  const cancelGesture = () => {
    gesture.current = null
    setHidden(null)
    requestLive()
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const native = e.nativeEvent
    if (e.pointerType === 'touch') {
      touches.current.add(e.pointerId)
      // A second finger means pinch/scroll, not writing: abandon the current stroke.
      if (touches.current.size > 1) {
        if (gesture.current?.kind === 'draw') cancelGesture()
        return
      }
    }
    if (e.pointerType === 'pen' && !penSeen) setPenSeen(true)
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (gesture.current) return

    const isTouch = e.pointerType === 'touch'
    const { x, y } = toPage(e)

    if (tool === 'pan') {
      if (isTouch) return // native scrolling handles touch panning
      gesture.current = { kind: 'pan', pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'text') {
      e.preventDefault()
      props.onTextAt(x, y)
      return
    }
    if (isTouch && !touchWrites) return

    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)

    if (tool === 'pen' || tool === 'highlighter') {
      gesture.current = { kind: 'draw', pointerId: e.pointerId, points: [x, y, pressureOf(native)], pointerType: e.pointerType }
    } else if (tool === 'eraser') {
      gesture.current = { kind: 'erase', pointerId: e.pointerId, hits: new Set() }
      eraseAt(x, y)
    } else if (tool === 'lasso') {
      const b = selectionBounds()
      if (selection.length > 0 && b && rectContains(b, x, y, 8)) {
        gesture.current = { kind: 'move', pointerId: e.pointerId, startX: x, startY: y, dx: 0, dy: 0 }
        setHidden(new Set(selection))
      } else {
        if (selection.length > 0) props.onSelectionChange([])
        gesture.current = { kind: 'lasso', pointerId: e.pointerId, points: [[x, y]] }
      }
    }
    requestLive()
  }

  const eraseAt = (x: number, y: number) => {
    const g = gesture.current
    if (g?.kind !== 'erase') return
    const radius = propsRef.current.eraserSize / 2
    let changed = false
    for (const s of propsRef.current.strokes) {
      if (!g.hits.has(s.id) && strokeHit(s, x, y, radius)) {
        g.hits.add(s.id)
        changed = true
      }
    }
    if (changed) setHidden(new Set(g.hits))
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    if (!g) {
      if (tool === 'eraser' && e.pointerType !== 'touch') {
        hover.current = toPage(e)
        requestLive()
      }
      return
    }
    if (g.pointerId !== e.pointerId) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    const samples = events.length > 0 ? events : [e.nativeEvent]

    if (g.kind === 'draw') {
      for (const ev of samples) {
        const { x, y } = toPage(ev)
        g.points.push(x, y, pressureOf(ev))
      }
    } else if (g.kind === 'erase') {
      for (const ev of samples) {
        const p = toPage(ev)
        hover.current = p
        eraseAt(p.x, p.y)
      }
    } else if (g.kind === 'lasso') {
      const { x, y } = toPage(e)
      g.points.push([x, y])
    } else if (g.kind === 'move') {
      const { x, y } = toPage(e)
      g.dx = round2(x - g.startX)
      g.dy = round2(y - g.startY)
    } else if (g.kind === 'pan') {
      props.onPan(g.lastX - e.clientX, g.lastY - e.clientY)
      g.lastX = e.clientX
      g.lastY = e.clientY
    }
    requestLive()
  }

  const finish = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch') touches.current.delete(e.pointerId)
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null

    if (cancelled) {
      // Browser took over (e.g. palm/scroll). Discard partial ink; keep completed erase/move.
      if (g.kind === 'draw' || g.kind === 'lasso') {
        requestLive()
        return
      }
    }

    if (g.kind === 'draw') {
      const p = propsRef.current
      p.onStroke({
        id: newId(),
        tool: p.tool === 'highlighter' ? 'highlighter' : 'pen',
        color: p.brush.color,
        size: p.brush.size,
        points: simplifyPoints(g.points),
      })
    } else if (g.kind === 'erase') {
      if (g.hits.size > 0) props.onErase([...g.hits])
      setHidden(null)
    } else if (g.kind === 'lasso') {
      const ids = propsRef.current.strokes.filter((s) => strokeInLasso(s, g.points)).map((s) => s.id)
      props.onSelectionChange(ids)
    } else if (g.kind === 'move') {
      if (g.dx !== 0 || g.dy !== 0) props.onMoveSelection(g.dx, g.dy)
      setHidden(null)
    }
    requestLive()
  }

  const touchAction = DRAW_TOOLS.includes(tool) && touchWrites ? 'none' : 'pan-x pan-y pinch-zoom'
  const cursor =
    tool === 'pan' ? 'grab' : tool === 'text' ? 'text' : tool === 'eraser' ? 'none' : tool === 'lasso' ? 'crosshair' : 'crosshair'

  return (
    <div className="relative" style={{ width: cssWidth, height: cssHeight }}>
      <canvas ref={baseRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <canvas
        ref={liveRef}
        role="img"
        aria-label={props.label}
        className="absolute inset-0 h-full w-full select-none"
        style={{ touchAction, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={() => {
          if (!gesture.current && hover.current) {
            hover.current = null
            requestLive()
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
