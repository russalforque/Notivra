import { useState, type FormEvent, type ReactNode } from 'react'
import { toUserMessage } from '../../lib/errors'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Field, Input } from './Field'

interface NameDialogProps {
  open: boolean
  onClose: () => void
  title: string
  label: string
  initialValue?: string
  submitLabel?: string
  placeholder?: string
  /** Extra controls rendered under the name field (e.g. a colour picker). */
  extra?: ReactNode
  onSubmit: (name: string) => Promise<void>
}

/** Small dialog to create or rename something by name. Validation errors come from the service. */
export function NameDialog(props: NameDialogProps) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.title} size="sm">
      {props.open && <NameForm {...props} />}
    </Dialog>
  )
}

function NameForm({ onClose, label, initialValue = '', submitLabel = 'Save', placeholder, extra, onSubmit }: NameDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <Field label={label} error={error}>
        {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus maxLength={120} />}
      </Field>
      {extra}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
