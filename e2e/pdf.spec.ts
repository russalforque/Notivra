import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

async function importFixture(page: Page) {
  await page.goto('/library')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import PDF' }).first().click()])
  await chooser.setFiles('e2e/fixtures/sample.pdf')
  await page.waitForURL(/\/library\/[0-9a-f-]{36}/)
  await expect(page.locator('[data-page-index="0"] canvas')).toBeVisible()
}

/** Screen position of the first annotation's bounding box relative to its page. */
async function firstAnnotationBox(page: Page) {
  return page.locator('[data-page-index="0"]').evaluate((pageEl) => {
    const shape = pageEl.querySelector('svg g > polyline:not([visibility="hidden"])') as SVGGraphicsElement | null
    if (!shape) return null
    const p = pageEl.getBoundingClientRect()
    const r = shape.getBoundingClientRect()
    return { x: (r.x - p.x) / p.width, y: (r.y - p.y) / p.height, w: r.width / p.width }
  })
}

test.describe('PDF workspace', () => {
  test('annotations stay in place after zoom and reload, and export as a valid PDF', async ({ page }) => {
    await importFixture(page)
    await page.getByRole('button', { name: 'Pen', exact: true }).click()
    const box = (await page.locator('[data-page-index="0"]').boundingBox())!
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35, { steps: 10 })
    await page.mouse.up()
    await expect(page.getByText('1 annotations')).toBeVisible()
    await expect(page.locator('[title="All changes saved on this device"]').first()).toBeVisible()

    const before = (await firstAnnotationBox(page))!
    expect(before.x).toBeCloseTo(0.2, 1)

    // Relative position on the page is identical at a different zoom level…
    await page.getByRole('button', { name: 'Zoom in' }).first().click()
    await page.getByRole('button', { name: 'Zoom in' }).first().click()
    await page.locator('#pdf-page-input').fill('1')
    await page.locator('#pdf-page-input').press('Enter')
    const zoomed = (await firstAnnotationBox(page))!
    expect(zoomed.x).toBeCloseTo(before.x, 2)
    expect(zoomed.y).toBeCloseTo(before.y, 2)
    expect(zoomed.w).toBeCloseTo(before.w, 2)

    // …and after reopening.
    await page.reload()
    await expect(page.getByText('1 annotations')).toBeVisible()
    await page.locator('#pdf-page-input').fill('1')
    await page.locator('#pdf-page-input').press('Enter')
    await expect.poll(async () => (await firstAnnotationBox(page))?.x).toBeCloseTo(before.x, 2)

    // Export produces a real PDF with the same pages.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()])
    const path = await download.path()
    const exported = await PDFDocument.load(readFileSync(path))
    expect(exported.getPageCount()).toBe(3)
    expect(download.suggestedFilename()).toMatch(/annotated\)\.pdf$/)
  })

  test('rotated pages render and accept annotations', async ({ page }) => {
    await importFixture(page)
    await page.locator('#pdf-page-input').fill('2')
    await page.locator('#pdf-page-input').press('Enter')
    const p2 = page.locator('[data-page-index="1"]')
    await expect(p2.locator('canvas')).toBeVisible()
    const box = (await p2.boundingBox())!
    expect(box.width).toBeGreaterThan(box.height) // /Rotate 90 → landscape on screen
    await page.getByRole('button', { name: 'Rectangle' }).click()
    await page.mouse.move(box.x + 50, box.y + 50)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, box.y + 120, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByText('1 annotations')).toBeVisible()
  })
})
