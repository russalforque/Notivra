import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Download, FileDown, GraduationCap, MoreVertical, Pencil, Redo2, RotateCw, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { NameDialog } from '../../components/ui/NameDialog'
import { Spinner } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import { db } from '../../db/database'
import type { Annotation, AnnotationShape, PdfDocument } from '../../db/types'
import { useAutosave } from '../../hooks/useAutosave'
import { useElementWidth } from '../../hooks/useElementWidth'
import { toUserMessage } from '../../lib/errors'
import { saveExport } from '../../services/storage/fileStore'
import { onDocumentAnnotated } from '../progress/xpTriggers'
import { SaveIndicator } from '../notebook/SaveIndicator'
import { AnnotationLayer } from './AnnotationLayer'
import { buildAnnotation, listAnnotations, persistAdd, persistRemove, persistUpdate } from './annotationService'
import { translateShape, TOOL_DEFAULTS } from './annotationGeometry'
import { viewportMatrix } from './coords'
import { loadDocumentBytes, markDocumentOpened, renameDocument, saveViewState } from './documentService'
import { PdfPageCanvas } from './PdfPageCanvas'
import { exportAnnotatedPdf } from './pdfExport'
import { closePdf, openPdf, type PDFDocumentProxy } from './pdfjs'
import { PdfToolbar, type PdfToolPrefs } from './PdfToolbar'

// ───────────── annotation operations (undoable, idempotent) ─────────────

type Op = { type: 'add'; ann: Annotation } | { type: 'remove'; ann: Annotation } | { type: 'update'; before: Annotation; after: Annotation }

function invert(op: Op): Op {
  if (op.type === 'add') return { type: 'remove', ann: op.ann }
  if (op.type === 'remove') return { type: 'add', ann: op.ann }
  return { type: 'update', before: op.after, after: op.before }
}

function reduceOps(list: Annotation[], ops: Op[]): Annotation[] {
  let next = list
  for (const op of ops) {
    if (op.type === 'add') next = next.some((a) => a.id === op.ann.id) ? next : [...next, op.ann]
    else if (op.type === 'remove') next = next.filter((a) => a.id !== op.ann.id)
    else next = next.map((a) => (a.id === op.after.id ? op.after : a))
  }
  return next
}

async function runOp(op: Op): Promise<void> {
  if (op.type === 'add') await persistAdd(op.ann)
  else if (op.type === 'remove') await persistRemove(op.ann.id)
  else await persistUpdate(op.after.id, { shape: op.after.shape, color: op.after.color })
}

// ───────────── page layout ─────────────

interface PageInfo {
  view: [number, number, number, number]
  rotate: number
  exact: boolean
}

const PAGE_GAP = 16
const PADDING = 16
const MIN_SCALE = 0.25
const MAX_SCALE = 5

function pageCssSize(info: PageInfo, scale: number, userRotation: number) {
  const rotation = (info.rotate + userRotation) % 360
  const w = (info.view[2] - info.view[0]) * scale
  const h = (info.view[3] - info.view[1]) * scale
  return rotation % 180 === 0 ? { width: w, height: h, rotation } : { width: h, height: w, rotation }
}

const PREFS_KEY = 'notivra.pdfToolPrefs'
function loadPrefs(): PdfToolPrefs {
  const defaults: PdfToolPrefs = { tool: 'pan', color: '#dc2626', highlightColor: '#facc15', penWidth: 1.5, shapeWidth: 2, fontSize: 14 }
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<PdfToolPrefs>), tool: 'pan' }
  } catch {
    return defaults
  }
}

export function PdfWorkspacePage() {
  const { documentId = '' } = useParams()
  const doc = useLiveQuery(async () => (await db.documents.get(documentId)) ?? null, [documentId])
  if (doc === undefined) return <Spinner label="Opening PDF" className="h-dvh" />
  if (!doc || doc.deletedAt !== null) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">PDF not found</h1>
        <p className="text-sm text-muted">It may have been deleted. Check the trash to restore it.</p>
        <Link to="/library" className="font-medium text-primary hover:underline">
          Back to library
        </Link>
      </div>
    )
  }
  return <Workspace key={doc.id} doc={doc} />
}

function Workspace({ doc }: { doc: PdfDocument }) {
  const navigate = useNavigate()
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [infos, setInfos] = useState<PageInfo[] | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null)
  const [history, setHistory] = useState<{ past: Op[][]; future: Op[][] }>({ past: [], future: [] })
  const [prefs, setPrefsState] = useState<PdfToolPrefs>(loadPrefs)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scaleMode, setScaleMode] = useState<number>(doc.lastScale) // 0 = fit width
  const [userRotation, setUserRotation] = useState<number>(doc.rotation)
  const [range, setRange] = useState({ first: 0, last: 2 })
  const [currentPage, setCurrentPage] = useState(doc.lastPage)
  const [penSeen, setPenSeen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fingerDrawing = useLiveQuery(async () => ((await db.settings.get('fingerDrawing'))?.value as boolean | undefined) ?? true, []) ?? true
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerWidth = useElementWidth(scrollRef)
  const queue = useRef<Op[]>([])
  const anchor = useRef({ index: doc.lastPage, fraction: 0 })
  const restored = useRef(false)
  const fileRef = useRef({ id: doc.id, fileKey: doc.fileKey, fileSyncStatus: doc.fileSyncStatus, remotePath: doc.remotePath })

  const setPrefs = (patch: Partial<PdfToolPrefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
    if (patch.tool && patch.tool !== 'select') setSelectedId(null)
  }

  // ── Load the PDF and its annotations ──
  useEffect(() => {
    let cancelled = false
    let instance: PDFDocumentProxy | null = null
    ;(async () => {
      const bytes = await loadDocumentBytes(fileRef.current)
      instance = await openPdf(bytes)
      if (cancelled) {
        void closePdf(instance)
        return
      }
      setPdf(instance)
      const first = await instance.getPage(1)
      const base: PageInfo = { view: first.view as PageInfo['view'], rotate: first.rotate, exact: false }
      setInfos(Array.from({ length: instance.numPages }, (_, i) => (i === 0 ? { ...base, exact: true } : base)))
    })().catch((e) => !cancelled && setLoadError(toUserMessage(e, 'This PDF could not be opened.')))
    listAnnotations(doc.id).then(
      (list) => !cancelled && setAnnotations(list),
      (e) => !cancelled && setLoadError(toUserMessage(e)),
    )
    void markDocumentOpened(doc.id)
    return () => {
      cancelled = true
      if (instance) void closePdf(instance)
    }
  }, [doc.id])

  // Fetch exact page geometry for visible pages (others use page 1 as an estimate).
  useEffect(() => {
    if (!pdf || !infos) return
    const missing: number[] = []
    for (let i = Math.max(0, range.first - 2); i <= Math.min(infos.length - 1, range.last + 2); i++) if (!infos[i]!.exact) missing.push(i)
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map((i) => pdf.getPage(i + 1))).then((pages) => {
      if (cancelled) return
      setInfos((prev) => {
        if (!prev) return prev
        const next = prev.slice()
        pages.forEach((p, k) => (next[missing[k]!] = { view: p.view as PageInfo['view'], rotate: p.rotate, exact: true }))
        return next
      })
    }, () => undefined)
    return () => {
      cancelled = true
    }
  }, [pdf, infos, range])

  // ── Persistence ──
  const persist = useCallback(async () => {
    let added = false
    while (queue.current.length > 0) {
      const op = queue.current[0]!
      await runOp(op)
      if (op.type === 'add') added = true
      queue.current.shift()
    }
    if (added) void onDocumentAnnotated(doc.id)
  }, [doc.id])
  const autosave = useAutosave<number>(persist, 150)

  const apply = (ops: Op[], record: 'new' | 'undo' | 'redo' = 'new') => {
    if (ops.length === 0) return
    setAnnotations((prev) => reduceOps(prev ?? [], ops))
    queue.current.push(...ops)
    autosave.schedule(Date.now())
    if (record === 'new') setHistory((h) => ({ past: [...h.past.slice(-99), ops], future: [] }))
  }

  const undo = () => {
    const ops = history.past[history.past.length - 1]
    if (!ops) return
    apply(ops.map(invert).reverse(), 'undo')
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [ops, ...h.future] }))
    setSelectedId(null)
  }
  const redo = () => {
    const [ops, ...rest] = history.future
    if (!ops) return
    apply(ops, 'redo')
    setHistory((h) => ({ past: [...h.past, ops], future: rest }))
  }

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const a of annotations ?? []) map.set(a.pageIndex, [...(map.get(a.pageIndex) ?? []), a])
    return map
  }, [annotations])

  // ── Layout ──
  const maxPageWidthAt1 = infos ? Math.max(...infos.slice(0, 50).map((i) => pageCssSize(i, 1, userRotation).width)) : 612
  const fitScale = containerWidth > 0 ? Math.max(MIN_SCALE, Math.min(3, (containerWidth - PADDING * 2) / maxPageWidthAt1)) : 1
  const scale = scaleMode > 0 ? scaleMode : fitScale
  const layout = useMemo(() => {
    if (!infos) return null
    const sizes = infos.map((info) => pageCssSize(info, scale, userRotation))
    const tops: number[] = []
    let y = PADDING
    for (const s of sizes) {
      tops.push(y)
      y += s.height + PAGE_GAP
    }
    const maxWidth = Math.max(...sizes.map((s) => s.width))
    return { sizes, tops, totalHeight: y + PADDING, innerWidth: Math.max(containerWidth, maxWidth + PADDING * 2) }
  }, [infos, scale, userRotation, containerWidth])

  const updateVisible = useCallback(() => {
    const el = scrollRef.current
    if (!el || !layout) return
    const top = el.scrollTop
    const vh = el.clientHeight
    const { tops, sizes } = layout
    const indexAt = (y: number) => {
      let lo = 0
      let hi = tops.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (tops[mid]! <= y) lo = mid
        else hi = mid - 1
      }
      return lo
    }
    const first = indexAt(top - vh * 0.5)
    const last = indexAt(top + vh * 1.5)
    const current = indexAt(top + vh * 0.3)
    anchor.current = { index: current, fraction: Math.max(0, (top - tops[current]!) / sizes[current]!.height) }
    setRange((r) => (r.first === first && r.last === last ? r : { first, last }))
    setCurrentPage(current)
  }, [layout])

  // Keep the same spot in view when zoom or rotation changes; restore the last page on open.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !layout) return
    if (!restored.current) {
      if (containerWidth === 0) return
      restored.current = true
      const i = Math.min(doc.lastPage, layout.tops.length - 1)
      el.scrollTop = layout.tops[i]! - PADDING
    } else {
      const { index, fraction } = anchor.current
      el.scrollTop = layout.tops[index]! + fraction * layout.sizes[index]!.height
    }
    updateVisible()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, userRotation, layout?.totalHeight, containerWidth])

  // Persist view state (device-local) shortly after it changes.
  useEffect(() => {
    const t = setTimeout(() => void saveViewState(doc.id, { lastPage: currentPage, lastScale: scaleMode, rotation: userRotation as PdfDocument['rotation'] }), 600)
    return () => clearTimeout(t)
  }, [doc.id, currentPage, scaleMode, userRotation])

  const goToPage = (index: number) => {
    if (!layout) return
    const i = Math.max(0, Math.min(index, layout.tops.length - 1))
    scrollRef.current?.scrollTo({ top: layout.tops[i]! - PADDING })
  }

  const zoomBy = (factor: number) => setScaleMode(Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(scale * factor * 100) / 100)))

  // Ctrl + wheel zoom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setScaleMode((s) => {
        const current = s > 0 ? s : fitScale
        return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(current * (e.deltaY < 0 ? 1.1 : 0.9) * 100) / 100))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fitScale])

  // ── Annotation callbacks ──
  const createAnnotation = (pageIndex: number, shape: AnnotationShape, style: { color: string; opacity: number }) => {
    apply([{ type: 'add', ann: buildAnnotation({ documentId: doc.id, pageIndex, color: style.color, opacity: style.opacity, shape }) }])
  }
  const eraseAnnotations = (ids: string[]) => {
    const set = new Set(ids)
    apply((annotations ?? []).filter((a) => set.has(a.id)).map((ann) => ({ type: 'remove' as const, ann })))
    setSelectedId(null)
  }
  const moveAnnotation = (id: string, dx: number, dy: number) => {
    const before = annotations?.find((a) => a.id === id)
    if (before) apply([{ type: 'update', before, after: { ...before, shape: translateShape(before.shape, dx, dy) } }])
  }
  const commitText = (pageIndex: number, existing: Annotation | null, x: number, y: number, text: string) => {
    if (existing) {
      if (!text) apply([{ type: 'remove', ann: existing }])
      else if (existing.shape.kind === 'text' && text !== existing.shape.text) apply([{ type: 'update', before: existing, after: { ...existing, shape: { ...existing.shape, text } } }])
    } else if (text) {
      createAnnotation(pageIndex, { kind: 'text', x, y, text, fontSize: prefs.fontSize }, { color: prefs.color, opacity: 1 })
    }
  }
  const recolorSelected = (color: string) => {
    const before = annotations?.find((a) => a.id === selectedId)
    if (before && before.color !== color) apply([{ type: 'update', before, after: { ...before, color } }])
  }

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        eraseAnnotations([selectedId])
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomBy(1.25)
      } else if (mod && e.key === '-') {
        e.preventDefault()
        zoomBy(0.8)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Export ──
  const exportPdf = async () => {
    setExporting(true)
    try {
      await autosave.flush()
      const bytes = await loadDocumentBytes(fileRef.current)
      const out = await exportAnnotatedPdf(bytes, annotations ?? [], doc.title)
      const where = await saveExport(`${safeName(doc.title)} (annotated).pdf`, out, 'application/pdf')
      toast.success(`Annotated PDF exported (${where}). The original is unchanged.`)
    } catch (err) {
      toast.error(toUserMessage(err, 'Export failed.'))
    } finally {
      setExporting(false)
    }
  }
  const downloadOriginal = async () => {
    try {
      const where = await saveExport(doc.fileName.toLowerCase().endsWith('.pdf') ? doc.fileName : `${doc.fileName}.pdf`, await loadDocumentBytes(fileRef.current), 'application/pdf')
      toast.success(`Original saved (${where}).`)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const style = {
    color: prefs.tool === 'highlighter' || prefs.tool === 'highlight' ? prefs.highlightColor : prefs.color,
    width: prefs.tool === 'highlighter' ? TOOL_DEFAULTS.highlighter.width : prefs.tool === 'pen' ? prefs.penWidth : prefs.shapeWidth,
    opacity: prefs.tool === 'highlighter' ? TOOL_DEFAULTS.highlighter.opacity : 1,
    fontSize: prefs.fontSize,
  }
  const touchWrites = fingerDrawing && !penSeen
  const selected = annotations?.find((a) => a.id === selectedId) ?? null
  const pageCount = infos?.length ?? doc.pageCount

  return (
    <div className="flex h-dvh flex-col bg-surface-3">
      <header className="pt-safe flex shrink-0 items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        <IconButton label="Back to library" onClick={() => navigate('/library')}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <button type="button" onClick={() => setRenaming(true)} className="min-w-0 truncate rounded-lg px-2 py-1 text-left font-semibold hover:bg-surface-2" title="Rename">
          {doc.title}
        </button>
        <SaveIndicator status={autosave.status} onRetry={autosave.retry} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="Undo (Ctrl+Z)" disabled={history.past.length === 0} onClick={undo}>
            <Undo2 className="size-5" />
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" disabled={history.future.length === 0} onClick={redo}>
            <Redo2 className="size-5" />
          </IconButton>
          <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <IconButton label="Zoom out" className="max-sm:hidden" onClick={() => zoomBy(0.8)} disabled={scale <= MIN_SCALE}>
            <ZoomOut className="size-5" />
          </IconButton>
          <button type="button" className="hidden w-14 text-center text-xs font-medium text-muted tabular-nums sm:block" onClick={() => setScaleMode(0)} title="Fit to width">
            {scaleMode === 0 ? 'Fit' : `${Math.round(scale * 100)}%`}
          </button>
          <IconButton label="Zoom in" className="max-sm:hidden" onClick={() => zoomBy(1.25)} disabled={scale >= MAX_SCALE}>
            <ZoomIn className="size-5" />
          </IconButton>
          <IconButton label="Rotate view" onClick={() => setUserRotation((r) => (r + 90) % 360)}>
            <RotateCw className="size-5" />
          </IconButton>
          <Button size="sm" variant="soft" className="ml-1 max-md:hidden" icon={<FileDown className="size-4" />} loading={exporting} onClick={() => void exportPdf()}>
            Export
          </Button>
          <Menu
            items={[
              { label: 'Export annotated PDF', icon: <FileDown />, onSelect: () => void exportPdf() },
              { label: 'Download original', icon: <Download />, onSelect: () => void downloadOriginal() },
              { label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(true) },
              { label: 'Make a study set from this PDF', icon: <GraduationCap />, onSelect: () => navigate(`/study/generate?document=${doc.id}`) },
              'separator',
              { label: 'Zoom in', icon: <ZoomIn />, onSelect: () => zoomBy(1.25) },
              { label: 'Zoom out', icon: <ZoomOut />, onSelect: () => zoomBy(0.8) },
              { label: 'Fit to width', onSelect: () => setScaleMode(0) },
            ]}
            trigger={(p) => (
              <IconButton {...p} label="More options">
                <MoreVertical className="size-5" />
              </IconButton>
            )}
          />
        </div>
      </header>

      <div className="shrink-0 border-b border-border bg-surface">
        <PdfToolbar prefs={prefs} onChange={setPrefs} selectedColor={selected?.color ?? null} onRecolorSelected={recolorSelected} />
      </div>

      {autosave.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
          <span className="min-w-0 flex-1">{autosave.error} Your annotations stay on screen until they are saved.</span>
          <Button size="sm" variant="danger" onClick={autosave.retry}>
            Retry now
          </Button>
        </div>
      )}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onScroll={() => requestAnimationFrame(updateVisible)} data-testid="pdf-scroll">
        {loadError ? (
          <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
            <p className="font-semibold">Can’t open this PDF</p>
            <p className="mt-2 text-sm text-muted">{loadError}</p>
          </div>
        ) : !pdf || !layout || !annotations ? (
          <Spinner label="Rendering PDF" />
        ) : (
          <div className="relative" style={{ height: layout.totalHeight, width: layout.innerWidth }}>
            {layout.sizes.slice(range.first, range.last + 1).map((size, k) => {
              const index = range.first + k
              const info = infos![index]!
              return (
                <div
                  key={index}
                  className="absolute bg-white shadow-[0_1px_8px_rgba(0,0,0,0.18)]"
                  style={{ top: layout.tops[index], left: (layout.innerWidth - size.width) / 2, width: size.width, height: size.height }}
                  data-page-index={index}
                  aria-label={`Page ${index + 1}`}
                  role="group"
                >
                  {info.exact && (
                    <>
                      <PdfPageCanvas pdf={pdf} pageNumber={index + 1} scale={scale} rotation={size.rotation} cssWidth={size.width} cssHeight={size.height} />
                      <AnnotationLayer
                        matrix={viewportMatrix(info.view, scale, size.rotation)}
                        cssWidth={size.width}
                        cssHeight={size.height}
                        annotations={byPage.get(index) ?? []}
                        tool={prefs.tool}
                        style={style}
                        selectedId={selectedId}
                        touchWrites={touchWrites}
                        onCreate={(shape, s) => createAnnotation(index, shape, s)}
                        onErase={eraseAnnotations}
                        onSelect={setSelectedId}
                        onMove={moveAnnotation}
                        onTextCommit={(existing, x, y, text) => commitText(index, existing, x, y, text)}
                        onPenSeen={() => setPenSeen(true)}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <footer className="pb-safe flex shrink-0 items-center justify-center gap-2 border-t border-border bg-surface px-3 py-1.5 text-sm">
        <label htmlFor="pdf-page-input" className="text-muted">
          Page
        </label>
        <input
          key={currentPage}
          id="pdf-page-input"
          type="number"
          min={1}
          max={pageCount}
          defaultValue={currentPage + 1}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goToPage(Number((e.target as HTMLInputElement).value) - 1)
          }}
          onBlur={(e) => goToPage(Number(e.target.value) - 1)}
          className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-center tabular-nums"
        />
        <span className="text-muted">of {pageCount}</span>
        <span className="ml-3 hidden text-xs text-muted sm:inline">{annotations?.length ?? 0} annotations</span>
      </footer>

      <NameDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename PDF"
        label="Title"
        initialValue={doc.title}
        onSubmit={(name) => renameDocument(doc.id, name)}
      />
    </div>
  )
}

function safeName(title: string): string {
  return title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'document'
}
