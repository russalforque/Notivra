import { AlertCircle, Check, Loader2 } from 'lucide-react'
import type { SaveState } from '../../services/saveStatus'
import { cn } from '../../lib/cn'

export function SaveIndicator({ status, onRetry }: { status: SaveState; onRetry: () => void }) {
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-2 py-1 text-xs font-semibold text-danger"
        aria-live="assertive"
      >
        <AlertCircle className="size-4" /> Not saved · Retry
      </button>
    )
  }
  const saving = status === 'saving' || status === 'unsaved'
  return (
    <span
      role="status"
      aria-live="polite"
      title={saving ? 'Saving to this device…' : 'All changes saved on this device'}
      className={cn('flex items-center gap-1.5 px-2 text-xs font-medium whitespace-nowrap', saving ? 'text-muted' : 'text-success')}
    >
      {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
      <span className="hidden sm:inline">{saving ? 'Saving…' : 'Saved'}</span>
    </span>
  )
}
