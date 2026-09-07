import { SettingsStore } from './settings'

/** The slice of Electron's `app` the boot step touches; a fake in tests. */
export interface BootApp {
  setPath(name: 'userData', path: string): void
  getPath(name: 'userData'): string
  disableHardwareAcceleration(): void
}

export interface Boot {
  settings: SettingsStore
  /** What the process was started with; `disableHardwareAcceleration` has no effect once the app is ready. */
  hardwareAcceleration: boolean
  /** The saved switch differs from the boot-time one: the change waits for a restart. */
  restartRequired(): boolean
}

/**
 * Runs before `app.whenReady`, synchronously: the settings store is read from
 * `userData` (moved first by the YUFA_USERDATA test hook) and hardware
 * acceleration switched off when the player asked for it. Everything else in
 * settings is read after ready, where it belongs.
 */
export function bootSettings(app: BootApp, env: NodeJS.ProcessEnv): Boot {
  if (env['YUFA_USERDATA']) app.setPath('userData', env['YUFA_USERDATA'])
  const settings = new SettingsStore(app.getPath('userData'))
  const hardwareAcceleration = settings.get().hardwareAcceleration
  if (!hardwareAcceleration) app.disableHardwareAcceleration()
  return {
    settings,
    hardwareAcceleration,
    restartRequired: () => settings.get().hardwareAcceleration !== hardwareAcceleration,
  }
}
