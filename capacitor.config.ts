import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.notivra.notebook',
  appName: 'Notivra',
  webDir: 'dist',
  android: {
    // Content is bundled in the APK; nothing is loaded from remote origins.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
}

export default config
