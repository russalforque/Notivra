import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Annotation, AnnotationShape } from '../../db/types'
import { arrowHead } from './pdfExport'
import { applyMatrix, invertMatrix, toSvgMatrix, type Matrix } from './coords'
import { hitTest, shapeBounds, simplifyInk, translateShape, type PdfTool } from './annotationGeometry'

export interface AnnotationStyle {
  color: string
  width: number
  opacity: number
  fontSize: number
}

interface Props {
  matrix: Matrix
  cssWidth: number
  cssHeight: number
  annotations: Annotation[]
  tool: PdfTool
  style: AnnotationStyle
  selectedId: string | null
  touchWrites: boolean
  onCreate: (shape: AnnotationShape, style: { color: string; opacity: number }) => void
  onErase: (ids: string[]) => void
  onSelect: (id: string | null) => void
  onMove: (id: string, dx: number, dy: number) => void
  onTextCommit: (existing: Annotation | null, x: number, y: number, text: string) => void
  onPenSeen: () => void
}

type Gesture =
  | { kind: 'ink'; pointerId: number; points: number[] }
  | { kind: 'box'; pointerId: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'erase'; pointerId: number; hits: Set<string> }
  | { kind: 'move'; pointerId: number; id: string; x0: number; y0: number }

interface TextEdit {
  existing: Annotation | null
  x: number
  y: number
  text: string
}

const DRAW_TOOLS: PdfTool[] = ['pen', 'highlighter', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'eraser', 'text', 'select']

/**
 * SVG overlay for one PDF page. Annotations are drawn inside a group transformed by the
 * page's viewport matrix, so they are expressed in PDF user space and follow zoom/rotation.
 */
export function AnnotationLayer(props: Props) {
  const { matrix, cssWidth, cssHeight, annotations, tool, style, selectedId, touchWrites } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const liveInk = useRef<SVGPolylineElement>(null)
  const liveBox = useRef<SVGRectElement>(null)
  const liveEllipse = useRef<SVGEllipseElement>(null)
  const liveLine = useRef<SVGLineElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [erasing, setErasing] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [edit, setEdit] = useState<TextEdit | null>(null)

  const inverse = useMemo(() => invertMatrix(matrix), [matrix])
  const scale = Math.hypot(matrix[0], matrix[1])
  const tolerance = 8 / scale

  const toPdf = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    const [x, y] = applyMatrix(inverse, e.clientX - r.left, e.clientY - r.top)
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
  }

  const topHit = (x: number, y: number) => [...annotations].reverse().find((a) => hitTest(a, x, y, tolerance)) ?? null

  const hideLive = () => {
    for (const el of [liveInk.current, liveBox.current, liveEllipse.current, liveLine.current]) el?.setAttribute('visibility', 'hidden')
  }

  const updateBox = (g: Extract<Gesture, { kind: 'box' }>) => {
    const x = Math.min(g.x0, g.x1)
    const y = Math.min(g.y0, g.y1)
    const w = Math.abs(g.x1 - g.x0)
    const h = Math.abs(g.y1 - g.y0)
    if (tool === 'ellipse') {
      const el = liveEllipse.current!
      el.setAttribute('cx', String(x + w / 2))
      el.setAttribute('cy', String(y + h / 2))
      el.setAttribute('rx', String(w / 2))
      el.setAttribute('ry', String(h / 2))
      el.setAttribute('visibility', 'visible')
    } else if (tool === 'line' || tool === 'arrow') {
      const el = liveLine.current!
      el.setAttribute('x1', String(g.x0))
      el.setAttribute('y1', String(g.y0))
      el.setAttribute('x2', String(g.x1))
      el.setAttribute('y2', String(g.y1))
      el.setAttribute('visibility', 'visible')
    } else {
      const el = liveBox.current!
      el.setAttribute('x', String(x))
      el.setAttribute('y', String(y))
      el.setAttribute('width', String(w))
      el.setAttribute('height', String(h))
      el.setAttribute('visibility', 'visible')
    }
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'pen') props.onPenSeen()
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.pointerType === 'touch' && !touchWrites) return
    if (gesture.current || edit) return
    const [x, y] = toPdf(e)

    if (tool === 'text') {
      e.preventDefault()
      const hit = topHit(x, y)
      if (hit?.shape.kind === 'text') setEdit({ existing: hit, x: hit.shape.x, y: hit.shape.y, text: hit.shape.text })
      else setEdit({ existing: null, x, y: y + style.fontSize * 0.6, text: '' })
      return
    }
    if (tool === 'select') {
      const hit = topHit(x, y)
      props.onSelect(hit?.id ?? null)
      if (hit) {
        e.currentTarget.setPointerCapture(e.pointerId)
        gesture.current = { kind: 'move', pointerId: e.pointerId, id: hit.id, x0: x, y0: y }
      }
      return
    }

    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'pen' || tool === 'highlighter') {
      gesture.current = { kind: 'ink', pointerId: e.pointerId, points: [x, y] }
      const el = liveInk.current!
      el.setAttribute('points', `${x},${y}`)
      el.setAttribute('stroke', style.color)
      el.setAttribute('stroke-width', String(style.width))
      el.setAttribute('stroke-opacity', String(style.opacity))
      el.setAttribute('visibility', 'visible')
    } else if (tool === 'eraser') {
      gesture.current = { kind: 'erase', pointerId: e.pointerId, hits: new Set() }
      eraseAt(x, y)
    } else {
      gesture.current = { kind: 'box', pointerId: e.pointerId, x0: x, y0: y, x1: x, y1: y }
    }
  }

  const eraseAt = (x: number, y: number) => {
    const g = gesture.current
    if (g?.kind !== 'erase') return
    let changed = false
    for (const a of annotations) {
      if (!g.hits.has(a.id) && hitTest(a, x, y, tolerance)) {
        g.hits.add(a.id)
        changed = true
      }
    }
    if (changed) setErasing(new Set(g.hits))
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? []
    const events = samples.length > 0 ? samples : [e.nativeEvent]
    if (g.kind === 'ink') {
      let added = ''
      for (const ev of events) {
        const [x, y] = toPdf(ev)
        g.points.push(x, y)
        added += ` ${x},${y}`
      }
      const el = liveInk.current!
      el.setAttribute('points', (el.getAttribute('points') ?? '') + added)
    } else if (g.kind === 'box') {
      ;[g.x1, g.y1] = toPdf(e)
      updateBox(g)
    } else if (g.kind === 'erase') {
      for (const ev of events) eraseAt(...toPdf(ev))
    } else if (g.kind === 'move') {
      const [x, y] = toPdf(e)
      setDrag({ id: g.id, dx: x - g.x0, dy: y - g.y0 })
    }
  }

  const finish = (e: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    hideLive()
    if (g.kind === 'ink') {
      if (!cancelled) props.onCreate({ kind: 'ink', points: simplifyInk(g.points), width: style.width }, { color: style.color, opacity: style.opacity })
    } else if (g.kind === 'box') {
      if (cancelled || (Math.abs(g.x1 - g.x0) < 2 && Math.abs(g.y1 - g.y0) < 2)) return
      const rect: [number, number, number, number] = [g.x0, g.y0, g.x1, g.y1]
      const shape: AnnotationShape =
        tool === 'highlight'
          ? { kind: 'highlight', rect }
          : tool === 'ellipse'
            ? { kind: 'ellipse', rect, width: style.width }
            : tool === 'line' || tool === 'arrow'
              ? { kind: tool, from: [g.x0, g.y0], to: [g.x1, g.y1], width: style.width }
              : { kind: 'rect', rect, width: style.width }
      props.onCreate(shape, { color: style.color, opacity: tool === 'highlight' ? 0.35 : style.opacity })
    } else if (g.kind === 'erase') {
      if (g.hits.size > 0) props.onErase([...g.hits])
      setErasing(new Set())
    } else if (g.kind === 'move') {
      if (drag && (Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5)) props.onMove(g.id, drag.dx, drag.dy)
      setDrag(null)
    }
  }

  const commitText = () => {
    if (!edit) return
    props.onTextCommit(edit.existing, edit.x, edit.y, edit.text.trim())
    setEdit(null)
  }

  const selected = annotations.find((a) => a.id === selectedId)
  const selectedBounds = selected ? shapeBounds(drag?.id === selected.id ? translateShape(selected.shape, drag.dx, drag.dy) : selected.shape) : null
  const interactive = tool !== 'pan'
  const touchAction = DRAW_TOOLS.includes(tool) && touchWrites ? 'none' : 'pan-x pan-y pinch-zoom'
  const editCss = edit ? applyMatrix(matrix, edit.x, edit.y) : null

  return (
    <>
      <svg
        ref={svgRef}
        width={cssWidth}
        height={cssHeight}
        className="absolute inset-0 select-none"
        style={{
          pointerEvents: interactive ? 'auto' : 'none',
          touchAction,
          cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onContextMenu={(e) => interactive && e.preventDefault()}
        aria-hidden
      >
        <g transform={toSvgMatrix(matrix)}>
          {annotations.map((a) => {
            if (erasing.has(a.id) || (edit?.existing?.id === a.id)) return null
            const shape = drag?.id === a.id ? translateShape(a.shape, drag.dx, drag.dy) : a.shape
            return <ShapeView key={a.id} shape={shape} color={a.color} opacity={a.opacity} />
          })}
          <polyline ref={liveInk} fill="none" strokeLinecap="round" strokeLinejoin="round" visibility="hidden" />
          <rect
            ref={liveBox}
            visibility="hidden"
            fill={tool === 'highlight' ? style.color : 'none'}
            fillOpacity={tool === 'highlight' ? 0.35 : 0}
            stroke={tool === 'highlight' ? 'none' : style.color}
            strokeWidth={style.width}
          />
          <ellipse ref={liveEllipse} visibility="hidden" fill="none" stroke={style.color} strokeWidth={style.width} />
          <line ref={liveLine} visibility="hidden" stroke={style.color} strokeWidth={style.width} strokeLinecap="round" />
          {selectedBounds && (
            <rect
              x={selectedBounds.x1 - 4 / scale}
              y={selectedBounds.y1 - 4 / scale}
              width={selectedBounds.x2 - selectedBounds.x1 + 8 / scale}
              height={selectedBounds.y2 - selectedBounds.y1 + 8 / scale}
              fill="none"
              stroke="#4f46e5"
              strokeWidth={1.5 / scale}
              strokeDasharray={`${5 / scale} ${4 / scale}`}
            />
          )}
        </g>
      </svg>
      {edit && editCss && (
        <textarea
          autoFocus
          aria-label="Annotation text"
          value={edit.text}
          placeholder="Type a note…"
          onChange={(e) => setEdit({ ...edit, text: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setEdit(null)
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText()
          }}
          className="absolute z-10 min-h-8 min-w-40 resize rounded border-2 border-indigo-400 bg-white/95 p-1 leading-[1.2] text-gray-900 shadow-lg outline-none"
          style={{
            left: editCss[0],
            top: editCss[1] - 2,
            fontSize: (edit.existing?.shape.kind === 'text' ? edit.existing.shape.fontSize : style.fontSize) * scale,
            color: edit.existing?.color ?? style.color,
          }}
        />
      )}
    </>
  )
}

function ShapeView({ shape, color, opacity }: { shape: AnnotationShape; color: string; opacity: number }) {
  const blend = opacity < 1 ? ({ mixBlendMode: 'multiply' } as const) : undefined
  switch (shape.kind) {
    case 'ink':
      if (shape.points.length === 2) {
        return <circle cx={shape.points[0]} cy={shape.points[1]} r={shape.width / 2} fill={color} fillOpacity={opacity} style={blend} />
      }
      return (
        <polyline
          points={pairs(shape.points)}
          fill="none"
          stroke={color}
          strokeOpacity={opacity}
          strokeWidth={shape.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={blend}
        />
      )
    case 'highlight': {
      const b = shapeBounds(shape)
      return <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={color} fillOpacity={opacity} style={{ mixBlendMode: 'multiply' }} />
    }
    case 'rect': {
      const b = shapeBounds(shape)
      return <rect x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={shape.width} />
    }
    case 'ellipse': {
      const b = shapeBounds(shape)
      return (
        <ellipse
          cx={(b.x1 + b.x2) / 2}
          cy={(b.y1 + b.y2) / 2}
          rx={(b.x2 - b.x1) / 2}
          ry={(b.y2 - b.y1) / 2}
          fill="none"
          stroke={color}
          strokeOpacity={opacity}
          strokeWidth={shape.width}
        />
      )
    }
    case 'line':
    case 'arrow':
      return (
        <g stroke={color} strokeOpacity={opacity} strokeWidth={shape.width} strokeLinecap="round" fill="none">
          <line x1={shape.from[0]} y1={shape.from[1]} x2={shape.to[0]} y2={shape.to[1]} />
          {shape.kind === 'arrow' &&
            arrowHead(shape.from, shape.to, shape.width).map(([hx, hy], i) => <line key={i} x1={shape.to[0]} y1={shape.to[1]} x2={hx} y2={hy} />)}
        </g>
      )
    case 'text':
      // PDF y grows upward: flip locally so glyphs render upright, lines flow downward.
      return (
        <text transform={`translate(${shape.x} ${shape.y}) scale(1 -1)`} fontSize={shape.fontSize} fill={color} fillOpacity={opacity} fontFamily="Helvetica, Arial, sans-serif">
          {shape.text.split('\n').map((line, i) => (
            <tspan key={i} x={0} dy={i === 0 ? shape.fontSize : shape.fontSize * 1.2}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      )
  }
}

function pairs(points: number[]): string {
  let s = ''
  for (let i = 0; i + 1 < points.length; i += 2) s += `${points[i]},${points[i + 1]} `
  return s
}
