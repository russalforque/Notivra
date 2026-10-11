import { BlendMode, EncryptedPDFError, LineCapStyle, PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib'
import type { Annotation } from '../../db/types'
import { AppError } from '../../lib/errors'
import { hexToRgb, toWinAnsi } from '../../lib/pdfText'

/** Ink points are stored flat: [x0, y0, x1, y1, …] in PDF user space. */
function inkPath(points: number[]): string {
  // drawSvgPath flips y around its origin, so negate y to stay in user space.
  let d = ''
  for (let i = 0; i + 1 < points.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${points[i]!.toFixed(2)} ${(-points[i + 1]!).toFixed(2)} `
  if (points.length === 2) d += `L${(points[0]! + 0.01).toFixed(2)} ${(-points[1]!).toFixed(2)}`
  return d.trim()
}

function drawAnnotation(page: PDFPage, a: Annotation, font: Awaited<ReturnType<PDFDocument['embedFont']>>): void {
  const color = hexToRgb(a.color)
  const s = a.shape
  switch (s.kind) {
    case 'ink':
      if (s.points.length < 2) return
      page.drawSvgPath(inkPath(s.points), {
        x: 0,
        y: 0,
        borderColor: color,
        borderWidth: s.width,
        borderOpacity: a.opacity,
        borderLineCap: LineCapStyle.Round,
        blendMode: a.opacity < 1 ? BlendMode.Multiply : undefined,
      })
      return
    case 'highlight': {
      const [x1, y1, x2, y2] = s.rect
      page.drawRectangle({
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        color,
        opacity: a.opacity,
        blendMode: BlendMode.Multiply,
      })
      return
    }
    case 'rect': {
      const [x1, y1, x2, y2] = s.rect
      page.drawRectangle({
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        borderColor: color,
        borderWidth: s.width,
        borderOpacity: a.opacity,
      })
      return
    }
    case 'ellipse': {
      const [x1, y1, x2, y2] = s.rect
      page.drawEllipse({
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2,
        xScale: Math.abs(x2 - x1) / 2,
        yScale: Math.abs(y2 - y1) / 2,
        borderColor: color,
        borderWidth: s.width,
        borderOpacity: a.opacity,
      })
      return
    }
    case 'line':
    case 'arrow': {
      const [x1, y1] = s.from
      const [x2, y2] = s.to
      const opts = { thickness: s.width, color, opacity: a.opacity, lineCap: LineCapStyle.Round }
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, ...opts })
      if (s.kind === 'arrow') {
        for (const [hx, hy] of arrowHead(s.from, s.to, s.width)) page.drawLine({ start: { x: x2, y: y2 }, end: { x: hx, y: hy }, ...opts })
      }
      return
    }
    case 'text': {
      const lines = toWinAnsi(s.text).split('\n')
      lines.forEach((line, i) => {
        if (!line) return
        page.drawText(line, { x: s.x, y: s.y - s.fontSize * (i + 1) * 1.2 + s.fontSize * 0.2, size: s.fontSize, font, color, opacity: a.opacity })
      })
      return
    }
  }
}

/** The two end points of an arrowhead at `to`, in the same coordinate space. */
export function arrowHead(from: [number, number], to: [number, number], width: number): [number, number][] {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const len = Math.max(8, width * 4)
  return [angle + Math.PI * 0.85, angle - Math.PI * 0.85].map((a) => [to[0] + Math.cos(a) * len, to[1] + Math.sin(a) * len])
}

/**
 * Returns a NEW PDF with annotations flattened into the page content. The original bytes are
 * copied first and never modified, so the stored original stays pristine.
 */
export async function exportAnnotatedPdf(original: Uint8Array, annotations: Annotation[], title?: string): Promise<Uint8Array> {
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(original.slice(), { updateMetadata: false })
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new AppError('This PDF is encrypted, so annotations cannot be written into it. You can still annotate it in Notivra.', { cause: error })
    }
    throw new AppError('This PDF could not be prepared for export.', { cause: error })
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  for (const a of annotations) {
    if (a.deletedAt !== null) continue
    const page = pages[a.pageIndex]
    if (page) drawAnnotation(page, a, font)
  }
  if (title) pdf.setTitle(title)
  pdf.setModificationDate(new Date())
  return pdf.save()
}
