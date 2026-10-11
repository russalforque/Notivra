// Renders public/favicon.svg into the PNG icons used by the web manifest and Android.
// Usage: node build/generate-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, Image } from '@napi-rs/canvas'

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url))

async function render(size, file, padding = 0) {
  const img = new Image()
  img.src = svg
  await new Promise((resolve) => setTimeout(resolve, 0))
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (padding > 0) {
    ctx.fillStyle = '#4f46e5'
    ctx.fillRect(0, 0, size, size)
  }
  const inner = size - padding * 2
  ctx.drawImage(img, padding, padding, inner, inner)
  writeFileSync(new URL(`../public/${file}`, import.meta.url), canvas.toBuffer('image/png'))
  console.log('wrote', file)
}

await render(192, 'icon-192.png')
await render(512, 'icon-512.png')
// Maskable icons need the logo inside the central safe zone (80%).
await render(512, 'icon-maskable-512.png', 56)
