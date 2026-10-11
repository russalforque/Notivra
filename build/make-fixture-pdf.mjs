// Generates e2e/fixtures/sample.pdf: 3 pages, page 2 rotated 90°, with recognizable text.
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

const pdf = await PDFDocument.create()
pdf.setTitle('Cell Biology Lecture')
const font = await pdf.embedFont(StandardFonts.Helvetica)
const lines = [
  'The cell is the basic unit of life.',
  'Mitochondria produce ATP through cellular respiration.',
  'The nucleus contains the genetic material (DNA).',
  'Ribosomes synthesize proteins from amino acids.',
]
for (let i = 0; i < 3; i++) {
  const page = pdf.addPage([612, 792])
  if (i === 1) page.setRotation(degrees(90))
  page.drawText(`Lecture page ${i + 1}`, { x: 72, y: 720, size: 28, font, color: rgb(0.1, 0.1, 0.4) })
  lines.forEach((l, k) => page.drawText(l, { x: 72, y: 660 - k * 28, size: 14, font }))
  page.drawRectangle({ x: 72, y: 200, width: 468, height: 200, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 })
}
writeFileSync(new URL('../e2e/fixtures/sample.pdf', import.meta.url), await pdf.save())
console.log('wrote e2e/fixtures/sample.pdf')
