import { toast } from '../../components/ui/toast'
import type { PdfDocument } from '../../db/types'
import { toUserMessage } from '../../lib/errors'
import { pickFiles, readFileBytes } from '../../lib/filePicker'
import { importPdf } from './documentService'
import { inspectPdf } from './pdfjs'

/** Imports files one by one, reporting each failure without stopping the rest. */
export async function importPdfFiles(files: File[], subjectId: string | null = null): Promise<PdfDocument[]> {
  const imported: PdfDocument[] = []
  for (const file of files) {
    try {
      const { document, duplicate } = await importPdf(file.name, await readFileBytes(file), inspectPdf, { subjectId })
      if (duplicate) toast.info(`“${file.name}” is already in your library.`)
      else imported.push(document)
    } catch (err) {
      toast.error(toUserMessage(err, `“${file.name}” could not be imported.`))
    }
  }
  if (imported.length === 1) toast.success(`Imported “${imported[0]!.title}”.`)
  else if (imported.length > 1) toast.success(`Imported ${imported.length} PDFs.`)
  return imported
}

export async function pickAndImportPdfs(subjectId: string | null = null): Promise<PdfDocument[]> {
  const files = await pickFiles('application/pdf,.pdf', true)
  if (files.length === 0) return []
  return importPdfFiles(files, subjectId)
}
