import type { UpdaterStatusEvent } from '@yufa/shared'

/**
 * The slice of electron-updater's `autoUpdater` the launcher drives; a fake
 * in tests. Configured (feed URL, auto-download, install on quit) by the
 * caller before it gets here.
 */
export interface UpdaterEngine {
  on(event: 'checking-for-update', listener: () => void): unknown
  on(event: 'update-not-available', listener: () => void): unknown
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

export interface SelfUpdater {
  /**
   * Asks the feed for a newer launcher. Startup calls it once; Settings'
   * Check now calls it again. A no-op while a check or a download is in
   * flight, and once an update is downloaded: restarting installs that one.
   */
  check(): void
  install(): void
}

/**
 * Wraps the engine (or nothing, in dev or with an unconfigured feed) behind
 * `check` and `install`, relaying its events as `updater:status`. Every
 * event goes out; the engine decides what a check means (with auto-download
 * on, an available update starts downloading by itself).
 */
export function createSelfUpdater(
  engine: UpdaterEngine | null,
  onStatus: (e: UpdaterStatusEvent) => void,
  log: { warn(message: string, err?: unknown): void },
): SelfUpdater {
  if (!engine) {
    return {
      check: () => onStatus({ status: 'none' }),
      install: () => {},
    }
  }

  // busy from check() until a terminal event (none, error); downloaded stays set until the restart installs it
  let busy = false
  let downloaded = false
  // download-progress carries no version; the one update-available named rides along for the status line
  let version: string | undefined
  const report = (e: UpdaterStatusEvent): void => {
    if (e.status === 'none' || e.status === 'error') busy = false
    if (e.status === 'ready') downloaded = true
    onStatus(e)
  }

  engine.on('checking-for-update', () => report({ status: 'checking' }))
  engine.on('update-not-available', () => report({ status: 'none' }))
  engine.on('update-available', (info) => {
    version = info.version
    report({ status: 'available', version })
  })
  engine.on('download-progress', (p) =>
    report({ status: 'downloading', ...(version ? { version } : {}), percent: Math.round(p.percent) }),
  )
  engine.on('update-downloaded', (info) => report({ status: 'ready', version: info.version }))
  engine.on('error', (err) => {
    log.warn('self-update error', err)
    report({ status: 'error' })
  })

  return {
    check: () => {
      if (busy || downloaded) return
      busy = true
      engine.checkForUpdates().catch((err) => {
        log.warn('checkForUpdates failed', err)
        report({ status: 'error' })
      })
    },
    install: () => engine.quitAndInstall(),
  }
}
