import { Capacitor } from '@capacitor/core'
import { toast } from '../components/ui/toast'
import { hasUnsavedWork } from './saveStatus'

let updateAccepted = false
let reloading = false

/**
 * Registers the app-shell service worker so the app loads offline after a refresh.
 * Not used in dev (assets are served by Vite) or in the native app (assets ship in the APK).
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const promptUpdate = (worker: ServiceWorker) => {
          toast.info('A new version of Notivra is ready.', {
            duration: 0,
            action: {
              label: 'Reload',
              onAction: () => {
                if (hasUnsavedWork()) {
                  toast.warning('Some changes are still being saved. Try again in a moment.')
                  promptUpdate(worker)
                  return
                }
                updateAccepted = true
                worker.postMessage('SKIP_WAITING')
              },
            },
          })
        }
        if (registration.waiting && navigator.serviceWorker.controller) promptUpdate(registration.waiting)
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(worker)
          })
        })
        // Reload only when the user accepted an update. The first install also fires
        // controllerchange (clients.claim) — reloading then would discard in-progress work.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!updateAccepted || reloading) return
          reloading = true
          window.location.reload()
        })
      })
      .catch(() => {
        // Offline reload support is unavailable, but the app still works while open.
      })
  })
}
