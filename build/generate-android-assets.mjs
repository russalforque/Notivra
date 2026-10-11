// Generates Android launcher icons (legacy + adaptive) and splash screens from the logo.
// Usage: node build/generate-android-assets.mjs   (after `npx cap add android`)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas, Image, loadImage } from '@napi-rs/canvas'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const res = join(root, 'android', 'app', 'src', 'main', 'res')
if (!existsSync(res)) {
  console.error('android/ not found — run `npx cap add android` first')
  process.exit(1)
}

const logoSvg = readFileSync(join(root, 'public', 'favicon.svg'))
// Foreground glyph only (no rounded square): the adaptive icon background supplies the colour.
const glyphSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M18 46V18l28 28V18" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="46" cy="46" r="4.5" fill="#fbbf24"/></svg>`)

function svgImage(buf) {
  const img = new Image()
  img.src = buf
  return img
}

function png(size, draw) {
  const canvas = createCanvas(size, size)
  draw(canvas.getContext('2d'), size)
  return canvas.toBuffer('image/png')
}

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [density, scale] of Object.entries(densities)) {
  const dir = join(res, `mipmap-${density}`)
  const legacy = Math.round(48 * scale)
  const adaptive = Math.round(108 * scale)
  writeFileSync(join(dir, 'ic_launcher.png'), png(legacy, (ctx, s) => ctx.drawImage(svgImage(logoSvg), 0, 0, s, s)))
  writeFileSync(
    join(dir, 'ic_launcher_round.png'),
    png(legacy, (ctx, s) => {
      ctx.beginPath()
      ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2)
      ctx.fillStyle = '#4f46e5'
      ctx.fill()
      const inset = s * 0.18
      ctx.drawImage(svgImage(glyphSvg), inset, inset, s - inset * 2, s - inset * 2)
    }),
  )
  // Adaptive foreground: keep the glyph inside the 66 % safe zone.
  writeFileSync(
    join(dir, 'ic_launcher_foreground.png'),
    png(adaptive, (ctx, s) => {
      const inset = s * 0.25
      ctx.drawImage(svgImage(glyphSvg), inset, inset, s - inset * 2, s - inset * 2)
    }),
  )
}
writeFileSync(
  join(res, 'values', 'ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#4F46E5</color>\n</resources>\n',
)

// Splash screens: same size as the generated defaults, logo centred on the paper colour.
for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const file = join(res, dir, 'splash.png')
  if (!existsSync(file)) continue
  const current = await loadImage(readFileSync(file))
  const canvas = createCanvas(current.width, current.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f7f6f3'
  ctx.fillRect(0, 0, current.width, current.height)
  const size = Math.min(current.width, current.height) * 0.28
  ctx.drawImage(svgImage(logoSvg), (current.width - size) / 2, (current.height - size) / 2, size, size)
  writeFileSync(file, canvas.toBuffer('image/png'))
}
console.log('Android icons and splash screens generated')
