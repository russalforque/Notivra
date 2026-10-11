import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { GripVertical, Minus, Plus, Trash2 } from 'lucide-react'
import type { TextBlock } from '../../db/types'

interface TextLayerProps {
  blocks: TextBlock[]
  scale: number
  editable: boolean
  autoFocusId: string | null
  onAutoFocused: () => void
  onChange: (id: string, patch: Partial<Omit<TextBlock, 'id'>>) => void
  onRemove: (id: string) => void
  onEditEnd: () => void
}

/** Typed notes rendered as HTML over the ink canvas so they stay crisp, selectable and accessible. */
export function TextLayer({ blocks, scale, editable, autoFocusId, onAutoFocused, onChange, onRemove, onEditEnd }: TextLayerProps) {
  return (
    // The wrapper never takes pointer events (the canvas below must receive taps); only the
    // text boxes themselves are interactive, and only while the text tool is active.
    <div className="pointer-events-none absolute inset-0">
      {blocks.map((b) => (
        <TextBlockView
          key={b.id}
          block={b}
          scale={scale}
          editable={editable}
          autoFocus={autoFocusId === b.id}
          onAutoFocused={onAutoFocused}
          onChange={onChange}
          onRemove={onRemove}
          onEditEnd={onEditEnd}
        />
      ))}
    </div>
  )
}

interface BlockProps {
  block: TextBlock
  scale: number
  editable: boolean
  autoFocus: boolean
  onAutoFocused: () => void
  onChange: TextLayerProps['onChange']
  onRemove: TextLayerProps['onRemove']
  onEditEnd: () => void
}

function TextBlockView({ block, scale, editable, autoFocus, onAutoFocused, onChange, onRemove, onEditEnd }: BlockProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const drag = useRef<{ pointerId: number; mode: 'move' | 'resize'; startX: number; startY: number; orig: TextBlock } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [block.text, block.fontSize, block.width, scale, editable])

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus()
      onAutoFocused()
    }
  }, [autoFocus, onAutoFocused])

  const style = {
    left: block.x * scale,
    top: block.y * scale,
    width: block.width * scale,
    fontSize: block.fontSize * scale,
    color: block.color,
  }

  if (!editable) {
    return (
      <div className="absolute leading-[1.4] break-words whitespace-pre-wrap" style={style}>
        {block.text}
      </div>
    )
  }

  const startDrag = (mode: 'move' | 'resize', e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { pointerId: e.pointerId, mode, startX: e.clientX, startY: e.clientY, orig: block }
  }
  const onDragMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = (e.clientX - d.startX) / scale
    const dy = (e.clientY - d.startY) / scale
    if (d.mode === 'move') onChange(block.id, { x: Math.round(d.orig.x + dx), y: Math.round(d.orig.y + dy) })
    else onChange(block.id, { width: Math.max(60, Math.round(d.orig.width + dx)) })
  }
  const endDrag = () => {
    drag.current = null
    onEditEnd()
  }

  return (
    <div className="group pointer-events-auto absolute" style={{ left: style.left, top: style.top, width: style.width }}>
      <div className="absolute -top-9 left-0 hidden items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-md group-focus-within:flex">
        <button
          type="button"
          aria-label="Move text box"
          title="Drag to move"
          className="flex size-7 cursor-move touch-none items-center justify-center rounded-md text-muted hover:bg-surface-2"
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => startDrag('move', e)}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Smaller text"
          className="flex size-7 items-center justify-center rounded-md hover:bg-surface-2"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(block.id, { fontSize: Math.max(10, block.fontSize - 2) })}
        >
          <Minus className="size-4" />
        </button>
        <span className="w-6 text-center text-xs tabular-nums text-muted">{block.fontSize}</span>
        <button
          type="button"
          aria-label="Larger text"
          className="flex size-7 items-center justify-center rounded-md hover:bg-surface-2"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(block.id, { fontSize: Math.min(72, block.fontSize + 2) })}
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Delete text box"
          className="flex size-7 items-center justify-center rounded-md text-danger hover:bg-surface-2"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onRemove(block.id)}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <textarea
        ref={ref}
        value={block.text}
        aria-label="Text note"
        placeholder="Type here…"
        spellCheck
        rows={1}
        onChange={(e) => onChange(block.id, { text: e.target.value })}
        onBlur={() => {
          onEditEnd()
          if (!block.text.trim()) onRemove(block.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          e.stopPropagation() // Keep editor shortcuts (P, E, Ctrl+Z…) out of typing.
        }}
        className="block w-full resize-none overflow-hidden rounded-sm border border-dashed border-transparent bg-transparent p-0 leading-[1.4] outline-none placeholder:text-gray-400 group-hover:border-indigo-300 focus:border-indigo-400"
        style={{ fontSize: style.fontSize, color: style.color }}
      />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize text box"
        className="absolute top-0 -right-2 hidden h-full w-3 cursor-ew-resize touch-none group-focus-within:block"
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => startDrag('resize', e)}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="mx-auto h-full w-1 rounded bg-indigo-300" />
      </div>
    </div>
  )
}
