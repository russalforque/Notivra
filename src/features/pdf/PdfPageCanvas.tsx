import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from './pdfjs'
import { canvasPixelRatio } from '../notebook/ink/render'
import { viewportMatrix } from './coords'

interface Props {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  /** Absolute rotation (page /Rotate + user rotation). */
  rotation: number
  cssWidth: number
  cssHeight: number
}

/**
 * Renders one PDF page to a canvas. New renders draw into an off-DOM canvas that replaces
 * the old one only when complete, so zooming never flashes a blank page.
 */
export function PdfPageCanvas({ pdf, pageNumber, scale, rotation, cssWidth, cssHeight }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let task: RenderTask | null = null
    const ratio = canvasPixelRatio(cssWidth, cssHeight)
    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale: scale * ratio, rotation })
        if (import.meta.env.DEV) {
          // Guard: our own matrix (used for annotations) must match pdf.js exactly.
          const css = page.getViewport({ scale, rotation }).transform
          const ours = viewportMatrix(page.view as [number, number, number, number], scale, rotation)
          if (css.some((v, i) => Math.abs(v - ours[i]!) > 1e-6)) console.error('Viewport matrix mismatch', css, ours)
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        canvas.className = 'absolute inset-0 h-full w-full'
        canvas.setAttribute('aria-hidden', 'true')
        task = page.render({ canvas, viewport })
        await task.promise
        if (cancelled || !hostRef.current) return
        hostRef.current.replaceChildren(canvas)
        setFailed(false)
      } catch (error) {
        if (cancelled || (error as { name?: string })?.name === 'RenderingCancelledException') return
        console.warn('Page render failed', error)
        setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNumber, scale, rotation, cssWidth, cssHeight])

  // Release the bitmap memory when the page scrolls far away (component unmounts).
  useEffect(() => {
    const host = hostRef.current
    return () => {
      host?.querySelectorAll('canvas').forEach((c) => {
        c.width = 0
        c.height = 0
      })
    }
  }, [])

  return (
    <>
      <div ref={hostRef} className="absolute inset-0" />
      {failed && <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">This page could not be rendered.</p>}
    </>
  )
}
