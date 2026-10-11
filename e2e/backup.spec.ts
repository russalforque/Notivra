import { expect, test } from '@playwright/test'
import { addText, createNotebook, waitSaved } from './helpers'

test('a full backup can be exported and restored into an empty app', async ({ page }) => {
  await createNotebook(page, 'Backup me')
  await addText(page, 'Krebs cycle happens in the mitochondria')
  await waitSaved(page)

  await page.goto('/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export full backup' }).click()])
  const backupPath = await download.path()
  expect(download.suggestedFilename()).toMatch(/\.notivra$/)

  // Wipe all local data, as if the browser data were cleared. Done from a same-origin page
  // that doesn't run the app, so no open connection blocks the deletion.
  await page.goto('/favicon.svg')
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('notivra')
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      }),
  )
  await page.goto('/notebooks')
  await expect(page.getByText('No notebooks yet')).toBeVisible()

  await page.goto('/settings')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Restore from backup…' }).click()])
  await chooser.setFiles(backupPath)
  await expect(page.getByRole('dialog', { name: 'Restore this backup?' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.getByText(/Restore complete/)).toBeVisible()

  await page.goto('/notebooks')
  await page.getByRole('link', { name: /Backup me/ }).first().click()
  await expect(page.getByTestId('page-surface')).toContainText('Krebs cycle happens in the mitochondria')
})
