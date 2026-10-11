import type { Notebook } from '../../db/types'
import { pickFiles, readFileBytes } from '../../lib/filePicker'
import { backupFileName, createBackup, parseBackup, restoreBackup, type RestoreReport } from '../../services/backup/backupService'
import { saveExport } from '../../services/storage/fileStore'

/** Exports a single notebook (pages + subject) as a portable `.notivra` file. */
export async function exportNotebookFile(notebook: Notebook): Promise<void> {
  const scope = { kind: 'notebook', notebookId: notebook.id } as const
  const { bytes } = await createBackup(scope)
  await saveExport(backupFileName(scope, notebook.title), bytes, 'application/zip')
}

/** Imports a `.notivra` notebook or full backup file chosen by the user. Null if cancelled. */
export async function importNotebookFile(): Promise<RestoreReport | null> {
  const [file] = await pickFiles('.notivra,application/zip')
  if (!file) return null
  const parsed = await parseBackup(await readFileBytes(file))
  return restoreBackup(parsed)
}
