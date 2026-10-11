// Copies pdf.js runtime assets (CMaps, standard fonts, wasm decoders, ICC profiles) into
// public/pdfjs so they are served locally and precached by the service worker. Without them
// some PDFs (CJK text, non-embedded fonts, JPEG2000/JBIG2 scans) render incorrectly offline.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const dest = join(root, 'public', 'pdfjs')

if (!existsSync(src)) {
  console.warn('pdfjs-dist not installed; skipping asset copy')
  process.exit(0)
}
mkdirSync(dest, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dest, dir), { recursive: true })
}
console.log('pdf.js assets copied to public/pdfjs')
