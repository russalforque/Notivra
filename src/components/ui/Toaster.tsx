import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '../../lib/cn'
import { dismissToast, useToasts, type ToastTone } from './toast'

const icons: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

const tones: Record<ToastTone, string> = {
  info: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
}

export function Toaster() {
  const toasts = useToasts()
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((t) => {
        const Icon = icons[t.tone]
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="animate-toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg"
          >
            <Icon className={cn('mt-0.5 size-5 shrink-0', tones[t.tone])} aria-hidden />
            <p className="min-w-0 flex-1 text-sm">{t.message}</p>
            {t.action && (
              <button
                type="button"
                className="shrink-0 text-sm font-semibold text-primary hover:underline"
                onClick={() => {
                  t.action?.onAction()
                  dismissToast(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="shrink-0 text-muted hover:text-fg" onClick={() => dismissToast(t.id)}>
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
