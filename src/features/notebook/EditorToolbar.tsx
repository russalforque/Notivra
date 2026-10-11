import { Eraser, Hand, Highlighter, Lasso, PenLine, Type } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { EditorTool } from './ink/InkCanvas'
import {
  ERASER_SIZES,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_SIZES,
  PEN_COLORS,
  PEN_SIZES,
  type ToolPrefs,
} from './toolPrefs'

const TOOLS: { id: EditorTool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'pen', label: 'Pen', key: 'P', icon: <PenLine className="size-5" /> },
  { id: 'highlighter', label: 'Highlighter', key: 'H', icon: <Highlighter className="size-5" /> },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: <Eraser className="size-5" /> },
  { id: 'lasso', label: 'Lasso select', key: 'S', icon: <Lasso className="size-5" /> },
  { id: 'text', label: 'Text', key: 'T', icon: <Type className="size-5" /> },
  { id: 'pan', label: 'Pan / scroll', key: 'V', icon: <Hand className="size-5" /> },
]

interface Props {
  prefs: ToolPrefs
  onChange: (patch: Partial<ToolPrefs>) => void
}

export function EditorToolbar({ prefs, onChange }: Props) {
  const { tool } = prefs
  return (
    <div role="toolbar" aria-label="Drawing tools" className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
      <div className="flex items-center gap-0.5 rounded-xl bg-surface-2 p-0.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tool === t.id}
            aria-label={`${t.label} (${t.key})`}
            title={`${t.label} (${t.key})`}
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

      {(tool === 'pen' || tool === 'text') && (
        <Swatches colors={PEN_COLORS} value={prefs.penColor} onChange={(c) => onChange({ penColor: c })} label="Pen color" />
      )}
      {tool === 'pen' && <Sizes sizes={PEN_SIZES} value={prefs.penSize} onChange={(s) => onChange({ penSize: s })} label="Pen size" color={prefs.penColor} />}
      {tool === 'highlighter' && (
        <>
          <Swatches colors={HIGHLIGHTER_COLORS} value={prefs.highlighterColor} onChange={(c) => onChange({ highlighterColor: c })} label="Highlighter color" />
          <Sizes
            sizes={HIGHLIGHTER_SIZES}
            value={prefs.highlighterSize}
            onChange={(s) => onChange({ highlighterSize: s })}
            label="Highlighter size"
            color={prefs.highlighterColor}
            scale={0.35}
          />
        </>
      )}
      {tool === 'eraser' && (
        <Sizes sizes={ERASER_SIZES} value={prefs.eraserSize} onChange={(s) => onChange({ eraserSize: s })} label="Eraser size" color="#94a3b8" scale={0.3} />
      )}
      {tool === 'lasso' && <span className="px-2 text-xs whitespace-nowrap text-muted">Circle strokes to select, then drag to move.</span>}
      {tool === 'text' && <span className="px-2 text-xs whitespace-nowrap text-muted">Tap the page to add a text box.</span>}
    </div>
  )
}

function Swatches({ colors, value, onChange, label }: { colors: readonly string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="ml-1 flex shrink-0 items-center gap-1 rounded-xl bg-surface-2 p-1">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('size-7 rounded-full border-2 transition-transform', value === c ? 'scale-110 border-fg' : 'border-transparent')}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

function Sizes({
  sizes,
  value,
  onChange,
  label,
  color,
  scale = 1.6,
}: {
  sizes: readonly number[]
  value: number
  onChange: (s: number) => void
  label: string
  color: string
  scale?: number
}) {
  return (
    <div role="radiogroup" aria-label={label} className="ml-1 flex shrink-0 items-center gap-0.5 rounded-xl bg-surface-2 p-0.5">
      {sizes.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={`${label} ${s}`}
          onClick={() => onChange(s)}
          className={cn('flex size-8 items-center justify-center rounded-lg', value === s ? 'bg-surface shadow-sm' : 'hover:bg-surface-3')}
        >
          <span className="rounded-full" style={{ width: Math.max(3, s * scale), height: Math.max(3, s * scale), backgroundColor: color, maxWidth: 20, maxHeight: 20 }} />
        </button>
      ))}
    </div>
  )
}
