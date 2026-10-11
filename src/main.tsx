import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import './index.css'
import { Bootstrap } from './app/Bootstrap'
import { router } from './app/router'
import { ConfirmProvider } from './components/ui/confirm'
import { Toaster } from './components/ui/Toaster'
import { registerServiceWorker } from './services/pwa'
import { applyTheme, getThemePreference } from './services/settings'

applyTheme(getThemePreference())
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getThemePreference() === 'system') applyTheme('system')
})
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <Bootstrap>
        <RouterProvider router={router} />
      </Bootstrap>
      <Toaster />
    </ConfirmProvider>
  </StrictMode>,
)
