import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileDown,
  Keyboard,
  LayoutTemplate,
  MoreVertical,
  PanelLeft,
  Plus,
  Redo2,
  Settings2,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { useConfirm } from '../../components/ui/confirm'
import { Dialog } from '../../components/ui/Dialog'
import { Menu } from '../../components/ui/Menu'
import { Spinner } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import { db } from '../../db/database'
import type { Notebook, Page, PageContent, PageTemplate, TextBlock } from '../../db/types'
import { useAutosave } from '../../hooks/useAutosave'
import { useElementWidth } from '../../hooks/useElementWidth'
import { cn } from '../../lib/cn'
import { ConflictError, RecordNotFoundError, toUserMessage } from '../../lib/errors'
import { newId } from '../../lib/ids'
import { saveExport } from '../../services/storage/fileStore'
import { onPageSaved } from '../progress/xpTriggers'
import { PAGE_TEMPLATES } from '../library/constants'
import { useNotebook } from '../library/hooks'
import { markNotebookOpened } from '../library/libraryService'
import { NotebookDialog } from '../library/NotebookDialog'
import { TemplatePreview } from '../library/TemplatePreview'
import { exportNotebookFile } from '../library/transfer'
import { EditorToolbar } from './EditorToolbar'
import { editorReducer, initEditorState, type EditorAction, type PageEditorState } from './editorState'
import { InkCanvas, type EditorTool } from './ink/InkCanvas'
import { exportNotebookPdf } from './notebookPdfExport'
import { PageStrip } from './PageStrip'
import { addPage, deletePage, listPages, movePage, restorePage, savePageContent, setPageTemplate } from './pageService'
import { SaveIndicator } from './SaveIndicator'
import { TextLayer } from './TextLayer'
import { PEN_COLORS, useToolPrefs } from './toolPrefs'

// ───────────── per-page editor states ─────────────

type EditorsState = Record<string, PageEditorState>
type EditorsAction =
  | { type: 'replace'; pageId: string; content: PageContent }
  /** `initial` seeds the page's editor state on its first edit (lazy init, no effects). */
  | { type: 'edit'; pageId: string; initial: PageContent; action: EditorAction }

function editorsReducer(state: EditorsState, a: EditorsAction): EditorsState {
  switch (a.type) {
    case 'replace':
      return { ...state, [a.pageId]: initEditorState(a.content) }
    case 'edit': {
      const current = state[a.pageId] ?? initEditorState(a.initial)
      const next = editorReducer(current, a.action)
      return next === current && state[a.pageId] ? state : { ...state, [a.pageId]: next }
    }
  }
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const MAX_FIT_WIDTH = 920

const contentCache = new WeakMap<Page, PageContent>()

/** Stable content object per loaded page record, so identity checks detect real edits only. */
function pageContent(p: Page): PageContent {
  let c = contentCache.get(p)
  if (!c) {
    c = { strokes: p.strokes, textBlocks: p.textBlocks }
    contentCache.set(p, c)
  }
  return c
}

export function NotebookEditorPage() {
  const { notebookId = '' } = useParams()
  const notebook = useNotebook(notebookId)

  if (notebook === undefined) return <Spinner label="Opening notebook" className="h-dvh" />
  if (notebook === null || notebook.deletedAt !== null) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">Notebook not found</h1>
        <p className="text-sm text-muted">It may have been deleted. Check the trash to restore it.</p>
        <div className="flex gap-2">
          <Link to="/notebooks" className="font-medium text-primary hover:underline">
            Back to notebooks
          </Link>
          <Link to="/trash" className="font-medium text-primary hover:underline">
            Open trash
          </Link>
        </div>
      </div>
    )
  }
  return <Editor key={notebook.id} notebook={notebook} />
}

function Editor({ notebook }: { notebook: Notebook }) {
  const notebookId = notebook.id
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [pages, setPages] = useState<Page[] | null>(null)
  const [editors, dispatchEditors] = useReducer(editorsReducer, {})
  const revs = useRef(new Map<string, number>())
  const baseline = useRef(new Map<string, PageContent>())
  const dirty = useRef(new Map<string, PageContent>())
  const editorsRef = useRef(editors)
  const [conflictPageId, setConflictPageId] = useState<string | null>(null)
  const [prefs, setPrefs] = useToolPrefs()
  const fingerDrawing = useLiveQuery(async () => ((await db.settings.get('fingerDrawing'))?.value as boolean | undefined) ?? true, []) ?? true
  const [selection, setSelection] = useState<string[]>([])
  const [focusTextId, setFocusTextId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showPages, setShowPages] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const [dialog, setDialog] = useState<'settings' | 'template' | 'shortcuts' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerWidth = useElementWidth(scrollRef)

  useEffect(() => {
    editorsRef.current = editors
  }, [editors])

  // ── Saving ──
  const saveDirty = useCallback(async () => {
    for (const [pageId, content] of [...dirty.current]) {
      const rev = revs.current.get(pageId)
      if (rev === undefined) continue
      try {
        const saved = await savePageContent(pageId, content, rev)
        revs.current.set(pageId, saved.rev)
        if (dirty.current.get(pageId) === content) dirty.current.delete(pageId)
        void onPageSaved(saved)
      } catch (err) {
        if (err instanceof ConflictError) setConflictPageId(pageId)
        if (err instanceof RecordNotFoundError) {
          dirty.current.delete(pageId)
          toast.error('A page you were editing was deleted elsewhere. Restore it from the trash or undo the delete.')
          continue
        }
        throw err
      }
    }
  }, [])
  const autosave = useAutosave<number>(saveDirty, 500)

  // Detect content changes (any page) and queue them for saving.
  useEffect(() => {
    let changed = false
    for (const [pageId, ed] of Object.entries(editors)) {
      if (baseline.current.get(pageId) !== ed.content) {
        baseline.current.set(pageId, ed.content)
        dirty.current.set(pageId, ed.content)
        changed = true
      }
    }
    if (changed) autosave.schedule(Date.now())
  }, [editors, autosave])

  // ── Loading pages ──
  const reloadPages = useCallback(async () => {
    const list = await listPages(notebookId)
    for (const p of list) {
      if (!editorsRef.current[p.id]) baseline.current.set(p.id, pageContent(p))
      const known = revs.current.get(p.id)
      if (known === undefined || p.rev > known) {
        revs.current.set(p.id, p.rev)
        // Changed elsewhere and not edited here: show the newer version.
        if (known !== undefined && editorsRef.current[p.id] && !dirty.current.has(p.id)) {
          baseline.current.set(p.id, pageContent(p))
          dispatchEditors({ type: 'replace', pageId: p.id, content: pageContent(p) })
        }
      }
    }
    setPages(list)
    return list
  }, [notebookId])

  useEffect(() => {
    // Async data loading: state is set after the await, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadPages().catch((err) => toast.error(toUserMessage(err, 'Could not load pages.')))
    void markNotebookOpened(notebookId)
  }, [notebookId, reloadPages])

  const requestedPage = params.get('page')
  const currentPage = pages ? (pages.find((p) => p.id === requestedPage) ?? pages[0] ?? null) : null
  const currentIndex = currentPage && pages ? pages.indexOf(currentPage) : -1
  const pageId = currentPage?.id ?? null

  const editor = pageId ? editors[pageId] : undefined
  const content = editor?.content ?? (currentPage ? pageContent(currentPage) : { strokes: [], textBlocks: [] })

  const contentFor = useCallback((p: Page) => editors[p.id]?.content ?? pageContent(p), [editors])

  const dispatch = useCallback(
    (action: EditorAction) => {
      if (currentPage) dispatchEditors({ type: 'edit', pageId: currentPage.id, initial: pageContent(currentPage), action })
    },
    [currentPage],
  )

  const goToPage = useCallback(
    (id: string) => {
      setSelection([])
      setParams({ page: id }, { replace: true })
      scrollRef.current?.scrollTo({ top: 0 })
    },
    [setParams],
  )

  // ── Page operations ──
  const onAddPage = async () => {
    try {
      const page = await addPage(notebookId, pageId, currentPage?.template ?? notebook.defaultTemplate)
      revs.current.set(page.id, page.rev)
      await reloadPages()
      goToPage(page.id)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const onDeletePage = async () => {
    if (!pages || !currentPage) return
    if (pages.length <= 1) {
      toast.info('A notebook needs at least one page. Use “Clear page” instead.')
      return
    }
    const ok = await confirm({
      title: `Delete page ${currentIndex + 1}?`,
      message: 'You can undo this right after deleting.',
      confirmLabel: 'Delete page',
      destructive: true,
    })
    if (!ok) return
    try {
      await autosave.flush()
      const id = currentPage.id
      const neighbour = pages[currentIndex + 1] ?? pages[currentIndex - 1]
      await deletePage(id)
      dirty.current.delete(id)
      await reloadPages()
      if (neighbour) goToPage(neighbour.id)
      toast.info('Page deleted.', {
        action: {
          label: 'Undo',
          onAction: () =>
            void restorePage(id)
              .then(async () => {
                const list = await reloadPages()
                const restored = list.find((p) => p.id === id)
                if (restored) revs.current.set(id, restored.rev)
                goToPage(id)
              })
              .catch((e) => toast.error(toUserMessage(e))),
        },
      })
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const onMovePage = async (id: string, toIndex: number) => {
    try {
      await autosave.flush()
      await movePage(notebookId, id, toIndex)
      await reloadPages()
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const onTemplate = async (template: PageTemplate) => {
    if (!currentPage) return
    try {
      await autosave.flush()
      const saved = await setPageTemplate(currentPage.id, template)
      revs.current.set(saved.id, saved.rev)
      await reloadPages()
      setDialog(null)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }

  const onClearPage = async () => {
    const ok = await confirm({
      title: 'Clear this page?',
      message: 'Removes all ink and text from this page. You can undo with Ctrl+Z.',
      confirmLabel: 'Clear page',
      destructive: true,
    })
    if (ok) {
      dispatch({ type: 'clearPage' })
      setSelection([])
    }
  }

  // ── Conflict resolution ──
  const keepMine = async () => {
    if (!conflictPageId) return
    const fresh = await db.pages.get(conflictPageId)
    if (fresh) revs.current.set(conflictPageId, fresh.rev)
    setConflictPageId(null)
    autosave.retry()
  }

  const loadTheirs = async () => {
    if (!conflictPageId) return
    const fresh = await db.pages.get(conflictPageId)
    dirty.current.delete(conflictPageId)
    if (fresh) {
      revs.current.set(fresh.id, fresh.rev)
      baseline.current.set(fresh.id, pageContent(fresh))
      dispatchEditors({ type: 'replace', pageId: fresh.id, content: pageContent(fresh) })
    }
    setConflictPageId(null)
    autosave.discard()
    if (dirty.current.size > 0) autosave.schedule(Date.now())
    await reloadPages()
  }

  // ── Exports ──
  const exportPdf = async () => {
    try {
      await autosave.flush()
      const list = pages ?? []
      const latest = list.map((p) => ({ ...p, ...contentFor(p) }))
      const bytes = await exportNotebookPdf(notebook, latest)
      const where = await saveExport(`${safeName(notebook.title)}.pdf`, bytes, 'application/pdf')
      toast.success(`PDF exported (${where}).`)
    } catch (err) {
      toast.error(toUserMessage(err, 'PDF export failed.'))
    }
  }

  /** Emergency copy when storage writes fail: downloads unsaved pages as JSON. */
  const downloadRescueCopy = async () => {
    const data = { notebook: notebook.title, exportedAt: new Date().toISOString(), pages: Object.fromEntries(dirty.current) }
    await saveExport(`${safeName(notebook.title)}-unsaved.json`, new TextEncoder().encode(JSON.stringify(data)), 'application/json')
    toast.success('Unsaved changes downloaded. Keep this file until saving works again.')
  }

  // ── Text ──
  const onTextAt = (x: number, y: number) => {
    const fontSize = 18
    const width = Math.max(120, Math.min(420, (currentPage?.width ?? 794) - x - 24))
    const block: TextBlock = { id: newId(), x: Math.round(x), y: Math.round(y - fontSize * 0.7), width, text: '', fontSize, color: prefs.penColor }
    dispatch({ type: 'addText', block })
    setFocusTextId(block.id)
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
        setSelection([])
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setZoom((z) => ZOOM_LEVELS.find((l) => l > z) ?? z)
      } else if (mod && e.key === '-') {
        e.preventDefault()
        setZoom((z) => [...ZOOM_LEVELS].reverse().find((l) => l < z) ?? z)
      } else if (!mod && !e.altKey) {
        const tools: Record<string, EditorTool> = { p: 'pen', h: 'highlighter', e: 'eraser', s: 'lasso', t: 'text', v: 'pan' }
        const tool = tools[e.key.toLowerCase()]
        if (tool) {
          setPrefs({ tool })
          if (tool !== 'lasso') setSelection([])
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length > 0) {
          dispatch({ type: 'removeStrokes', ids: selection })
          setSelection([])
        } else if (e.key === 'Escape') {
          setSelection([])
        } else if (e.key === 'PageDown' && pages && currentIndex < pages.length - 1) {
          goToPage(pages[currentIndex + 1]!.id)
        } else if (e.key === 'PageUp' && pages && currentIndex > 0) {
          goToPage(pages[currentIndex - 1]!.id)
        } else if (e.key === '?') {
          setDialog('shortcuts')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, selection, pages, currentIndex, goToPage, setPrefs])

  // Ctrl + wheel zoom on desktop.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => Math.min(3, Math.max(0.5, Math.round(z * (e.deltaY < 0 ? 1.1 : 0.9) * 100) / 100)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const fitWidth = Math.max(260, Math.min(MAX_FIT_WIDTH, containerWidth - (containerWidth < 640 ? 16 : 48)))
  const cssWidth = Math.round(fitWidth * zoom)
  const scale = currentPage ? cssWidth / currentPage.width : 1
  const brush = prefs.tool === 'highlighter' ? { color: prefs.highlighterColor, size: prefs.highlighterSize } : { color: prefs.penColor, size: prefs.penSize }
  const canUndo = (editor?.past.length ?? 0) > 0
  const canRedo = (editor?.future.length ?? 0) > 0
  const pageLabel = pages ? `Page ${currentIndex + 1} of ${pages.length}` : ''

  const pageMenu = useMemo(
    () => [
      { label: 'Notebook settings', icon: <Settings2 />, onSelect: () => setDialog('settings') },
      { label: 'Page template', icon: <LayoutTemplate />, onSelect: () => setDialog('template') },
      { label: 'Add page after this', icon: <Plus />, onSelect: () => void onAddPage() },
      'separator' as const,
      { label: 'Export as PDF', icon: <FileDown />, onSelect: () => void exportPdf() },
      {
        label: 'Export notebook file',
        icon: <Download />,
        onSelect: () =>
          void autosave
            .flush()
            .then(() => exportNotebookFile(notebook))
            .then(() => toast.success('Notebook file exported.'))
            .catch((e) => toast.error(toUserMessage(e))),
      },
      { label: 'Keyboard shortcuts', icon: <Keyboard />, onSelect: () => setDialog('shortcuts') },
      'separator' as const,
      { label: 'Clear page', icon: <Eraser />, onSelect: () => void onClearPage() },
      { label: 'Delete page', icon: <Trash2 />, danger: true, onSelect: () => void onDeletePage() },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, currentPage, notebook],
  )

  return (
    <div className="flex h-dvh flex-col bg-surface-2">
      {/* Top bar */}
      <header className="pt-safe flex shrink-0 items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        <IconButton label="Back to notebooks" onClick={() => navigate('/notebooks')}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <IconButton label={showPages ? 'Hide pages' : 'Show pages'} active={showPages} onClick={() => setShowPages((s) => !s)}>
          <PanelLeft className="size-5" />
        </IconButton>
        <button
          type="button"
          onClick={() => setDialog('settings')}
          className="min-w-0 truncate rounded-lg px-2 py-1 text-left font-semibold hover:bg-surface-2"
          title="Notebook settings"
        >
          {notebook.title}
        </button>
        <SaveIndicator status={autosave.status} onRetry={autosave.retry} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })}>
            <Undo2 className="size-5" />
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => dispatch({ type: 'redo' })}>
            <Redo2 className="size-5" />
          </IconButton>
          <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <IconButton label="Zoom out" className="hidden sm:inline-flex" disabled={zoom <= 0.5} onClick={() => setZoom((z) => [...ZOOM_LEVELS].reverse().find((l) => l < z) ?? z)}>
            <ZoomOut className="size-5" />
          </IconButton>
          <button type="button" className="hidden w-12 text-center text-xs font-medium text-muted tabular-nums sm:block" onClick={() => setZoom(1)} title="Fit to width">
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="Zoom in" className="hidden sm:inline-flex" disabled={zoom >= 3} onClick={() => setZoom((z) => ZOOM_LEVELS.find((l) => l > z) ?? z)}>
            <ZoomIn className="size-5" />
          </IconButton>
          <Menu
            items={pageMenu}
            trigger={(p) => (
              <IconButton {...p} label="More options">
                <MoreVertical className="size-5" />
              </IconButton>
            )}
          />
        </div>
      </header>

      <div className="shrink-0 border-b border-border bg-surface">
        <EditorToolbar
          prefs={prefs}
          onChange={(patch) => {
            setPrefs(patch)
            if (patch.tool && patch.tool !== 'lasso') setSelection([])
          }}
        />
      </div>

      {(conflictPageId || (autosave.status === 'error' && !autosave.conflict)) && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
          {conflictPageId ? (
            <>
              <span className="min-w-0 flex-1">This page was changed in another tab or window. Which version do you want to keep?</span>
              <Button size="sm" variant="secondary" onClick={() => void loadTheirs()}>
                Load other version
              </Button>
              <Button size="sm" variant="danger" onClick={() => void keepMine()}>
                Keep my version
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1">{autosave.error} Your changes stay on screen until they are saved.</span>
              <Button size="sm" variant="secondary" onClick={() => void downloadRescueCopy()}>
                Download unsaved copy
              </Button>
              <Button size="sm" variant="danger" onClick={autosave.retry}>
                Retry now
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {showPages && pages && (
          <aside className="hidden w-40 shrink-0 border-r border-border bg-surface md:block">
            <PageStrip pages={pages} currentId={pageId} contentFor={contentFor} onSelect={goToPage} onAdd={() => void onAddPage()} onMove={(id, i) => void onMovePage(id, i)} />
          </aside>
        )}

        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto" data-testid="editor-scroll">
          {!currentPage ? (
            <Spinner label="Loading pages" />
          ) : (
            <div className="flex min-h-full flex-col items-center px-2 py-4 sm:px-6 sm:py-6" style={{ minWidth: cssWidth + 16 }}>
              <div className="relative shadow-[0_2px_12px_rgba(0,0,0,0.12)]" style={{ width: cssWidth }} data-testid="page-surface">
                <InkCanvas
                  pageWidth={currentPage.width}
                  pageHeight={currentPage.height}
                  cssWidth={cssWidth}
                  template={currentPage.template}
                  strokes={content.strokes}
                  tool={prefs.tool}
                  brush={brush}
                  eraserSize={prefs.eraserSize}
                  fingerDrawing={fingerDrawing}
                  selection={selection}
                  label={`${notebook.title}, ${pageLabel}. Drawing area.`}
                  onStroke={(stroke) => dispatch({ type: 'addStroke', stroke })}
                  onErase={(ids) => dispatch({ type: 'removeStrokes', ids })}
                  onSelectionChange={setSelection}
                  onMoveSelection={(dx, dy) => dispatch({ type: 'moveStrokes', ids: selection, dx, dy })}
                  onTextAt={onTextAt}
                  onPan={(dx, dy) => scrollRef.current?.scrollBy(dx, dy)}
                />
                <TextLayer
                  blocks={content.textBlocks}
                  scale={scale}
                  editable={prefs.tool === 'text'}
                  autoFocusId={focusTextId}
                  onAutoFocused={() => setFocusTextId(null)}
                  onChange={(id, patch) => dispatch({ type: 'editText', id, patch })}
                  onRemove={(id) => dispatch({ type: 'removeText', id })}
                  onEditEnd={() => dispatch({ type: 'endCoalesce' })}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {selection.length > 0 && prefs.tool === 'lasso' && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-border bg-surface p-1.5 shadow-xl" role="toolbar" aria-label="Selection actions">
            <span className="px-2 text-xs font-medium text-muted">{selection.length} selected</span>
            {PEN_COLORS.slice(0, 4).map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Recolor to ${c}`}
                className="size-7 rounded-full border border-border"
                style={{ backgroundColor: c }}
                onClick={() => dispatch({ type: 'recolorStrokes', ids: selection, color: c })}
              />
            ))}
            <IconButton
              label="Duplicate selection"
              size="sm"
              onClick={() => {
                const newIds = selection.map(() => newId())
                dispatch({ type: 'duplicateStrokes', ids: selection, newIds, dx: 24, dy: 24 })
                setSelection(newIds)
              }}
            >
              <Copy className="size-4" />
            </IconButton>
            <IconButton
              label="Delete selection"
              size="sm"
              className="text-danger"
              onClick={() => {
                dispatch({ type: 'removeStrokes', ids: selection })
                setSelection([])
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
            <IconButton label="Clear selection" size="sm" onClick={() => setSelection([])}>
              <X className="size-4" />
            </IconButton>
          </div>
        </div>
      )}

      {/* Page navigation */}
      <footer className="pb-safe flex shrink-0 items-center justify-center gap-2 border-t border-border bg-surface px-2 py-1.5">
        <IconButton label="Previous page" disabled={!pages || currentIndex <= 0} onClick={() => pages && goToPage(pages[currentIndex - 1]!.id)}>
          <ChevronLeft className="size-5" />
        </IconButton>
        <span className="min-w-28 text-center text-sm font-medium tabular-nums" aria-live="polite">
          {pageLabel}
        </span>
        <IconButton label="Next page" disabled={!pages || currentIndex >= pages.length - 1} onClick={() => pages && goToPage(pages[currentIndex + 1]!.id)}>
          <ChevronRight className="size-5" />
        </IconButton>
        <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => void onAddPage()}>
          Page
        </Button>
      </footer>

      <NotebookDialog open={dialog === 'settings'} notebook={notebook} onClose={() => setDialog(null)} />

      <Dialog open={dialog === 'template'} onClose={() => setDialog(null)} title="Page template" size="sm">
        <div className="grid grid-cols-4 gap-2">
          {PAGE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void onTemplate(t.id)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border p-2 text-xs',
                currentPage?.template === t.id ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-surface-2',
              )}
            >
              <TemplatePreview template={t.id} />
              {t.label}
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} title="Keyboard shortcuts" size="sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {[
            ['P / H / E', 'Pen, highlighter, eraser'],
            ['S', 'Lasso select'],
            ['T', 'Text'],
            ['V', 'Pan'],
            ['Ctrl+Z', 'Undo'],
            ['Ctrl+Shift+Z, Ctrl+Y', 'Redo'],
            ['Delete', 'Delete selection'],
            ['Ctrl + / Ctrl −', 'Zoom'],
            ['PageUp / PageDown', 'Previous / next page'],
            ['Esc', 'Clear selection, leave text box'],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
              </dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  )
}

function safeName(title: string): string {
  return title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'notebook'
}
