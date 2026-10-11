import { useSyncExternalStore } from 'react'

export type ToastTone = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: number
  tone: ToastTone
  message: string
  action?: { label: string; onAction: () => void }
  duration: number
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id)
  emit()
}

function push(tone: ToastTone, message: string, options: { action?: ToastItem['action']; duration?: number } = {}): number {
  const id = nextId++
  // Errors stay longer: users must be able to read why something was not saved.
  const duration = options.duration ?? (tone === 'error' ? 9000 : options.action ? 7000 : 3500)
  items = [...items.slice(-3), { id, tone, message, action: options.action, duration }]
  emit()
  if (duration > 0) setTimeout(() => dismissToast(id), duration)
  return id
}

export const toast = {
  info: (m: string, o?: Parameters<typeof push>[2]) => push('info', m, o),
  success: (m: string, o?: Parameters<typeof push>[2]) => push('success', m, o),
  warning: (m: string, o?: Parameters<typeof push>[2]) => push('warning', m, o),
  error: (m: string, o?: Parameters<typeof push>[2]) => push('error', m, o),
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, () => items, () => items)
}
