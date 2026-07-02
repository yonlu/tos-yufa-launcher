import { app } from 'electron'
import log from 'electron-log/main'
import electronUpdater from 'electron-updater'
import type { UpdaterStatusEvent } from '@yufa/shared'

const { autoUpdater } = electronUpdater

export interface SelfUpdater {
  check(): void
  install(): void
}

export function initSelfUpdate(
  feedUrl: string,
  onStatus: (e: UpdaterStatusEvent) => void,
): SelfUpdater {
  if (!app.isPackaged || feedUrl.includes('REPLACE_WITH_DOMAIN')) {
    // dev mode or unconfigured feed — self-update disabled
    return {
      check: () => onStatus({ status: 'none' }),
      install: () => {},
    }
  }

  autoUpdater.logger = log
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => onStatus({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => onStatus({ status: 'none' }))
  autoUpdater.on('update-available', (info) => onStatus({ status: 'available', version: info.version }))
  autoUpdater.on('download-progress', (p) =>
    onStatus({ status: 'downloading', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) => onStatus({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    log.warn('self-update error', err)
    onStatus({ status: 'error' })
  })

  return {
    check: () => {
      autoUpdater.checkForUpdates().catch((err) => {
        log.warn('checkForUpdates failed', err)
        onStatus({ status: 'error' })
      })
    },
    install: () => autoUpdater.quitAndInstall(),
  }
}
