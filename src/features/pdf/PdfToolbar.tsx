import type { ReactNode } from 'react'
import { ArrowUpRight, Circle, Eraser, Hand, Highlighter, Minus, MousePointer2, PenLine, Square, SquareDashed, Type } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { PdfTool } from './annotationGeometry'

export const ANNOTATION_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#1f2937', '#7c3aed', '#f97316'] as const
export const HIGHLIGHT_COLORS = ['#facc15', '#4ade80', '#f472b6', '#60a5fa', '#fb923c'] as const

const TOOLS: { id: PdfTool; label: string; icon: ReactNode }[] = [
  { id: 'pan', label: 'Scroll', icon: <Hand className="size-5" /> },
  { id: 'select', label: 'Select & move', icon: <MousePointer2 className="size-5" /> },
  { id: 'pen', label: 'Pen', icon: <PenLine className="size-5" /> },
  { id: 'highlighter', label: 'Highlighter pen', icon: <Highlighter className="size-5" /> },
  { id: 'highlight', label: 'Highlight area', icon: <SquareDashed className="size-5" /> },
  { id: 'text', label: 'Text note', icon: <Type className="size-5" /> },
  { id: 'rect', label: 'Rectangle', icon: <Square className="size-5" /> },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle className="size-5" /> },
  { id: 'line', label: 'Line', icon: <Minus className="size-5" /> },
  { id: 'arrow', label: 'Arrow', icon: <ArrowUpRight className="size-5" /> },
  { id: 'eraser', label: 'Eraser', icon: <Eraser className="size-5" /> },
]

export interface PdfToolPrefs {
  tool: PdfTool
  color: string
  highlightColor: string
  penWidth: number
  shapeWidth: number
  fontSize: number
}

interface Props {
  prefs: PdfToolPrefs
  onChange: (patch: Partial<PdfToolPrefs>) => void
  selectedColor?: string | null
  onRecolorSelected?: (color: string) => void
}

export function PdfToolbar({ prefs, onChange, selectedColor, onRecolorSelected }: Props) {
  const { tool } = prefs
  const usesHighlight = tool === 'highlighter' || tool === 'highlight'
  const colors = usesHighlight ? HIGHLIGHT_COLORS : ANNOTATION_COLORS
  const activeColor = tool === 'select' ? (selectedColor ?? '') : usesHighlight ? prefs.highlightColor : prefs.color
  const showColors = tool !== 'pan' && tool !== 'eraser' && (tool !== 'select' || !!selectedColor)

  return (
    <div role="toolbar" aria-label="Annotation tools" className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
      <div className="flex items-center gap-0.5 rounded-xl bg-surface-2 p-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tool === t.id}
            aria-label={t.label}
            title={t.label}
            onClick={() => onChange({ tool: t.id })}
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              tool === t.id ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {t.icon}
          </button>
        ))}
      </div>
      {showColors && (
        <div role="radiogroup" aria-label="Color" className="ml-1 flex shrink-0 items-center gap-1 rounded-xl bg-surface-2 p-1">
          {(tool === 'select' ? [...ANNOTATION_COLORS, ...HIGHLIGHT_COLORS.slice(0, 2)] : colors).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={activeColor === c}
              aria-label={c}
              onClick={() => {
                if (tool === 'select') onRecolorSelected?.(c)
                else onChange(usesHighlight ? { highlightColor: c } : { color: c })
              }}
              className={cn('size-7 rounded-full border-2', activeColor === c ? 'scale-110 border-fg' : 'border-transparent')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
      {(tool === 'pen' || tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow') && (
        <WidthPicker
          values={[1, 1.5, 3, 5]}
          value={tool === 'pen' ? prefs.penWidth : prefs.shapeWidth}
          onChange={(w) => onChange(tool === 'pen' ? { penWidth: w } : { shapeWidth: w })}
          label="Line width"
        />
      )}
      {tool === 'text' && <WidthPicker values={[10, 14, 18, 24]} value={prefs.fontSize} onChange={(w) => onChange({ fontSize: w })} label="Font size" asText />}
    </div>
  )
}

function WidthPicker({ values, value, onChange, label, asText }: { values: number[]; value: number; onChange: (v: number) => void; label: string; asText?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="ml-1 flex shrink-0 items-center gap-0.5 rounded-xl bg-surface-2 p-0.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={`${label} ${v}`}
          onClick={() => onChange(v)}
          className={cn('flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-xs font-medium', value === v ? 'bg-surface shadow-sm' : 'text-muted hover:bg-surface-3')}
        >
          {asText ? v : <span className="w-4 rounded-full bg-fg" style={{ height: Math.max(1, v) }} />}
        </button>
      ))}
    </div>
  )
}
