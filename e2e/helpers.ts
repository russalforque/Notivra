import { expect, type Page } from '@playwright/test'

export async function createNotebook(page: Page, title: string) {
  await page.goto('/notebooks')
  await page.getByRole('button', { name: 'New notebook' }).first().click()
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: 'Create notebook' }).click()
  await page.waitForURL(/\/notebooks\/[0-9a-f-]{36}/)
  await expect(page.getByTestId('page-surface')).toBeVisible()
}

/** Draws a wavy stroke on the notebook page with the mouse. */
export async function drawStroke(page: Page, yOffset = 150) {
  const canvas = page.getByTestId('page-surface').locator('canvas').nth(1)
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 100, box.y + yOffset)
  await page.mouse.down()
  for (let i = 0; i <= 30; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + yOffset + Math.sin(i / 4) * 20)
  await page.mouse.up()
}

export async function addText(page: Page, text: string, yOffset = 300) {
  await page.keyboard.press('t')
  const canvas = page.getByTestId('page-surface').locator('canvas').nth(1)
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + 120, box.y + yOffset)
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
  await page.keyboard.press('p')
}

export async function waitSaved(page: Page) {
  await expect(page.locator('[title="All changes saved on this device"]').first()).toBeVisible()
}

/** Counts non-template ink pixels on the base canvas — robust check that strokes rendered. */
export async function inkPixelCount(page: Page): Promise<number> {
  return page.getByTestId('page-surface').locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let n = 0
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 90 && data[i + 1]! < 90 && data[i + 2]! < 90) n++
    return n
  })
}
