import { useEffect, useRef, useState } from 'react'
import type { PageContent, PageTemplate } from '../../db/types'
import { renderPage } from './ink/render'

interface Props {
  content: PageContent
  template: PageTemplate
  pageWidth: number
  pageHeight: number
  width: number
}

/** Lazily rendered page preview (only drawn once scrolled into view). */
export function PageThumb({ content, template, pageWidth, pageHeight, width }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const height = Math.round((width * pageHeight) / pageWidth)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !visible) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const s = (width / pageWidth) * ratio
    ctx.setTransform(s, 0, 0, s, 0, 0)
    renderPage(ctx, { template, width: pageWidth, height: pageHeight, strokes: content.strokes })
    // Text as grey bars: legible at thumbnail size is impossible anyway.
    ctx.fillStyle = 'rgba(30,41,59,0.45)'
    for (const b of content.textBlocks) {
      const lines = Math.max(1, b.text.split('\n').length)
      for (let i = 0; i < lines; i++) ctx.fillRect(b.x, b.y + i * b.fontSize * 1.4 + b.fontSize * 0.3, b.width * 0.8, b.fontSize * 0.6)
    }
  }, [visible, content, template, width, height, pageWidth, pageHeight])

  return <canvas ref={ref} style={{ width, height }} className="block rounded-md bg-paper" aria-hidden />
}
