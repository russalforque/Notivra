import { expect, test } from '@playwright/test'
import { addText, createNotebook, drawStroke, inkPixelCount, waitSaved } from './helpers'

test.describe('notebooks (offline-first)', () => {
  test('notes persist across reloads', async ({ page }) => {
    await createNotebook(page, 'Persistence test')
    await drawStroke(page)
    await addText(page, 'Photosynthesis converts light to energy')
    await waitSaved(page)
    const inkBefore = await inkPixelCount(page)
    expect(inkBefore).toBeGreaterThan(50)

    await page.reload()
    await expect(page.getByTestId('page-surface')).toContainText('Photosynthesis converts light to energy')
    await expect.poll(() => inkPixelCount(page)).toBeGreaterThan(inkBefore * 0.9)
  })

  test('the app reloads and works fully offline', async ({ page, context }) => {
    await page.goto('/')
    // Wait for the service worker to take control so the shell is cached.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible()

    await createNotebook(page, 'Written offline')
    await drawStroke(page)
    await addText(page, 'No internet needed')
    await waitSaved(page)
    await page.reload()
    await expect(page.getByTestId('page-surface')).toContainText('No internet needed')
    await context.setOffline(false)
  })

  test('undo and redo strokes', async ({ page }) => {
    await createNotebook(page, 'Undo test')
    await drawStroke(page)
    await waitSaved(page)
    const drawn = await inkPixelCount(page)
    await page.keyboard.press('Control+z')
    await expect.poll(() => inkPixelCount(page)).toBeLessThan(drawn * 0.1)
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(() => inkPixelCount(page)).toBeGreaterThan(drawn * 0.9)
  })

  test('pages can be added and navigated', async ({ page }) => {
    await createNotebook(page, 'Pages test')
    await addText(page, 'First page text')
    await page.getByRole('button', { name: 'Page', exact: true }).click()
    await expect(page.getByText('Page 2 of 2')).toBeVisible()
    await addText(page, 'Second page text')
    await waitSaved(page)
    await page.getByRole('button', { name: 'Previous page' }).click()
    await expect(page.getByTestId('page-surface')).toContainText('First page text')
    await page.reload()
    await expect(page.getByText(/Page 1 of 2/)).toBeVisible()
  })

  test('storage failures never silently discard edits @mobile', async ({ page }) => {
    // Simulate a full disk: every IndexedDB write fails until the flag is cleared.
    await page.addInitScript(() => {
      const w = window as unknown as { __failWrites: boolean }
      w.__failWrites = false
      const orig = { put: IDBObjectStore.prototype.put, add: IDBObjectStore.prototype.add }
      for (const name of ['put', 'add'] as const) {
        IDBObjectStore.prototype[name] = function (this: IDBObjectStore, ...args: unknown[]) {
          if (w.__failWrites && this.name === 'pages') throw new DOMException('Simulated full disk', 'QuotaExceededError')
          return (orig[name] as (...a: unknown[]) => IDBRequest).apply(this, args)
        } as never
      }
    })
    await createNotebook(page, 'Quota test')
    await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = true))
    await addText(page, 'Important exam notes')

    const alert = page.getByRole('alert').filter({ hasText: /storage|saved/i })
    await expect(alert).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download unsaved copy' })).toBeVisible()
    await expect(page.getByTestId('page-surface')).toContainText('Important exam notes')

    // Space is freed: retry saves the edit that was kept in memory.
    await page.evaluate(() => ((window as unknown as { __failWrites: boolean }).__failWrites = false))
    await page.getByRole('button', { name: 'Retry now' }).click()
    await waitSaved(page)
    await page.reload()
    await expect(page.getByTestId('page-surface')).toContainText('Important exam notes')
  })
})
