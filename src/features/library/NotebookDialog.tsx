import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field, Input, Select } from '../../components/ui/Field'
import { ColorSwatches } from '../../components/ui/misc'
import { toast } from '../../components/ui/toast'
import type { Notebook, PageTemplate } from '../../db/types'
import { toUserMessage } from '../../lib/errors'
import { cn } from '../../lib/cn'
import { PAGE_TEMPLATES, PALETTE } from './constants'
import { useFolders, useSubjects } from './hooks'
import { createNotebook, updateNotebook } from './libraryService'
import { onNotebookCreated } from '../progress/xpTriggers'
import { TemplatePreview } from './TemplatePreview'

interface Props {
  open: boolean
  onClose: () => void
  /** Edit mode when provided. */
  notebook?: Notebook
  defaultSubjectId?: string | null
}

export function NotebookDialog({ open, onClose, notebook, defaultSubjectId = null }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={notebook ? 'Notebook settings' : 'New notebook'}>
      {open && <NotebookForm key={notebook?.id ?? 'new'} notebook={notebook} defaultSubjectId={defaultSubjectId} onDone={onClose} />}
    </Dialog>
  )
}

function NotebookForm({ notebook, defaultSubjectId, onDone }: { notebook?: Notebook; defaultSubjectId: string | null; onDone: () => void }) {
  const navigate = useNavigate()
  const subjects = useSubjects() ?? []
  const folders = useFolders() ?? []
  const [title, setTitle] = useState(notebook?.title ?? '')
  const [subjectId, setSubjectId] = useState<string | null>(notebook?.subjectId ?? defaultSubjectId)
  const [folderId, setFolderId] = useState<string | null>(notebook?.folderId ?? null)
  const [color, setColor] = useState<string>(notebook?.color ?? PALETTE[0])
  const [template, setTemplate] = useState<PageTemplate>(notebook?.defaultTemplate ?? 'lined')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const subjectFolders = folders.filter((f) => f.subjectId === subjectId)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (notebook) {
        await updateNotebook(notebook.id, { title, subjectId, folderId, color, defaultTemplate: template })
        toast.success('Notebook updated')
        onDone()
      } else {
        const created = await createNotebook({ title, subjectId, folderId, color, template })
        void onNotebookCreated()
        onDone()
        navigate(`/notebooks/${created.id}`)
      }
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <Field label="Title" error={error}>
        {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Biology — Cell structure" autoFocus maxLength={120} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Subject">
          {(p) => (
            <Select
              {...p}
              value={subjectId ?? ''}
              onChange={(e) => {
                setSubjectId(e.target.value || null)
                setFolderId(null)
              }}
            >
              <option value="">No subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Folder">
          {(p) => (
            <Select {...p} value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)} disabled={subjectFolders.length === 0}>
              <option value="">{subjectFolders.length === 0 ? 'No folders' : 'No folder'}</option>
              {subjectFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Cover color</span>
        <ColorSwatches colors={PALETTE} value={color} onChange={setColor} label="Cover color" />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{notebook ? 'Template for new pages' : 'Page template'}</legend>
        <div className="grid grid-cols-4 gap-2">
          {PAGE_TEMPLATES.map((t) => (
            <label
              key={t.id}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-2 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                template === t.id ? 'border-primary bg-primary-soft text-primary' : 'border-border',
              )}
            >
              <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} className="sr-only" />
              <TemplatePreview template={t.id} />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {notebook ? 'Save' : 'Create notebook'}
        </Button>
      </div>
    </form>
  )
}
