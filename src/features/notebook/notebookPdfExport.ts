import { BlendMode, PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Notebook, Page } from '../../db/types'
import { hexToRgb, toWinAnsi, wrapText } from '../../lib/pdfText'
import { outlineToSvgPath, strokeOutline } from './ink/geometry'
import { GRID_SPACING, HIGHLIGHTER_ALPHA, LINE_SPACING } from './ink/render'

/** Page units are CSS pixels at 96 dpi; PDF points are 1/72 inch. */
const PT_PER_UNIT = 72 / 96

/**
 * Exports notebook pages as a vector PDF (ink stays sharp at any zoom, text is real text).
 */
export async function exportNotebookPdf(notebook: Notebook, pages: Page[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(notebook.title)
  pdf.setCreator('Notivra')
  pdf.setProducer('Notivra')
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  for (const page of pages) {
    const W = page.width * PT_PER_UNIT
    const H = page.height * PT_PER_UNIT
    const pdfPage = pdf.addPage([W, H])
    const k = PT_PER_UNIT
    pdfPage.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 0.976) })

    // Template
    const line = rgb(0.78, 0.83, 0.93)
    if (page.template === 'lined') {
      for (let y = LINE_SPACING * 3; y < page.height - 8; y += LINE_SPACING) {
        pdfPage.drawLine({ start: { x: 0, y: H - y * k }, end: { x: W, y: H - y * k }, thickness: 0.6, color: line })
      }
      pdfPage.drawLine({ start: { x: 80 * k, y: 0 }, end: { x: 80 * k, y: H }, thickness: 0.6, color: rgb(0.95, 0.72, 0.72) })
    } else if (page.template === 'grid') {
      for (let x = GRID_SPACING; x < page.width; x += GRID_SPACING) {
        pdfPage.drawLine({ start: { x: x * k, y: 0 }, end: { x: x * k, y: H }, thickness: 0.4, color: line })
      }
      for (let y = GRID_SPACING; y < page.height; y += GRID_SPACING) {
        pdfPage.drawLine({ start: { x: 0, y: H - y * k }, end: { x: W, y: H - y * k }, thickness: 0.4, color: line })
      }
    } else if (page.template === 'dotted') {
      for (let x = GRID_SPACING; x < page.width; x += GRID_SPACING) {
        for (let y = GRID_SPACING; y < page.height; y += GRID_SPACING) {
          pdfPage.drawCircle({ x: x * k, y: H - y * k, size: 0.8, color: rgb(0.7, 0.76, 0.89) })
        }
      }
    }

    // Ink — drawSvgPath flips the y axis around (x, y), so the origin is the top-left corner.
    for (const stroke of page.strokes) {
      const path = outlineToSvgPath(strokeOutline(stroke))
      if (!path) continue
      const highlighter = stroke.tool === 'highlighter'
      pdfPage.drawSvgPath(path, {
        x: 0,
        y: H,
        scale: k,
        color: hexToRgb(stroke.color),
        opacity: highlighter ? HIGHLIGHTER_ALPHA : 1,
        blendMode: highlighter ? BlendMode.Multiply : undefined,
      })
    }

    // Typed text
    for (const block of page.textBlocks) {
      const size = block.fontSize * k
      const lineHeight = size * 1.4
      const lines = wrapText(toWinAnsi(block.text), font, size, block.width * k)
      lines.forEach((text, i) => {
        if (!text) return
        pdfPage.drawText(text, {
          x: block.x * k,
          y: H - block.y * k - size - i * lineHeight + size * 0.2,
          size,
          font,
          color: hexToRgb(block.color),
        })
      })
    }
  }
  return pdf.save()
}
