import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import log from 'electron-log/main'
import { IPC, type LaunchResult, type PatcherProgressEvent, type PatcherStateEvent, type Settings } from '@yufa/shared'
import { DEFAULT_GAME_DIR, FALLBACK_NEWS_URL, LAUNCHER_FEED_URL, MANIFEST_URL } from './constants'
import { isGameRunning, launchGame } from './game'
import { cleanupStaleParts, gamePaths, isValidGameDir, probePatchDirWritable } from './localState'
import { fetchNews } from './news'
import { Patcher } from './patcher'
import { initSelfUpdate, type SelfUpdater } from './selfUpdate'
import { SettingsStore } from './settings'
import { createMainWindow } from './window'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  log.initialize()
  log.info(`launcher ${app.getVersion()} starting (manifest: ${MANIFEST_URL})`)

  const settings = new SettingsStore(app.getPath('userData'))
  if (!settings.get().gamePath) {
    settings.set({ gamePath: await detectGamePath() })
  }

  let win: BrowserWindow | null = null
  const send = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const electronFetch = ((input: string | URL | Request, init?: RequestInit) =>
    net.fetch(input as string, init)) as typeof fetch

  let patcher = buildPatcher()
  function buildPatcher(): Patcher {
    const gameDir = settings.get().gamePath
    return new Patcher({
      gameDir,
      manifestUrl: MANIFEST_URL,
      launcherVersion: app.getVersion(),
      fetchImpl: electronFetch,
      isGameRunning,
      onState: (e: PatcherStateEvent) => {
        log.info(`patcher: ${e.state}${e.error ? ` (${e.error.code}: ${e.error.message ?? ''})` : ''}`)
        send(IPC.patcherState, e)
      },
      onProgress: (e: PatcherProgressEvent) => send(IPC.patcherProgress, e),
    })
  }

  const updater: SelfUpdater = initSelfUpdate(LAUNCHER_FEED_URL, (e) => {
    log.info(`self-update: ${e.status}${e.version ? ` ${e.version}` : ''}`)
    send(IPC.updaterStatus, e)
  })

  // ---- IPC ----
  ipcMain.handle(IPC.patcherCheck, async () => {
    const gameDir = settings.get().gamePath
    if (!(await isValidGameDir(gameDir))) {
      const e: PatcherStateEvent = { state: 'error', error: { code: 'bad-game-path', message: gameDir } }
      send(IPC.patcherState, e)
      return e
    }
    if (!(await probePatchDirWritable(gamePaths(gameDir)))) {
      const e: PatcherStateEvent = { state: 'error', error: { code: 'patch-dir-readonly' } }
      send(IPC.patcherState, e)
      return e
    }
    void cleanupStaleParts(gamePaths(gameDir))
    return patcher.check()
  })
  ipcMain.handle(IPC.patcherStart, () => {
    void patcher.update()
  })
  ipcMain.handle(IPC.patcherRepair, () => {
    void patcher.repair()
  })
  ipcMain.handle(IPC.patcherCancel, () => patcher.cancel())

  ipcMain.handle(IPC.gameLaunch, async (): Promise<LaunchResult> => {
    const s = settings.get()
    const st = patcher.state
    const playable =
      st.state === 'ready' ||
      st.state === 'up-to-date' ||
      (st.state === 'error' && st.error?.code === 'offline' && st.offlinePlayable === true && s.allowOfflinePlay)
    if (!playable) {
      return { ok: false, error: { code: 'download-failed', message: 'not ready to play' } }
    }
    if (await isGameRunning()) return { ok: false, error: { code: 'game-running' } }

    const result = await launchGame(gamePaths(s.gamePath), s.launchArgs)
    log.info(`game launch: ${result.ok ? 'ok' : `failed (${result.error?.message ?? ''})`}`)
    if (result.ok) {
      if (s.afterLaunch === 'quit') setTimeout(() => app.quit(), 1500)
      else if (s.afterLaunch === 'minimize') win?.minimize()
    }
    return result
  })

  ipcMain.handle(IPC.settingsGet, (): Settings => settings.get())
  ipcMain.handle(IPC.settingsSet, (_e, partial: Partial<Settings>): Settings => {
    const before = settings.get().gamePath
    const after = settings.set(partial)
    if (after.gamePath !== before) patcher = buildPatcher()
    return after
  })
  ipcMain.handle(IPC.settingsSelectGamePath, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Selecione a pasta do jogo',
      defaultPath: settings.get().gamePath || undefined,
      properties: ['openDirectory'],
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    const valid = await isValidGameDir(path)
    if (valid) {
      settings.set({ gamePath: path })
      patcher = buildPatcher()
    }
    return { path, valid }
  })

  ipcMain.handle(IPC.newsGet, () => {
    const newsUrl = patcher.loadedManifest?.newsUrl ?? FALLBACK_NEWS_URL
    return fetchNews(newsUrl, join(app.getPath('userData'), 'news-cache.json'), electronFetch)
  })

  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())
  ipcMain.handle(IPC.appOpenExternal, (_e, url: string) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle(IPC.appOpenLogs, () => {
    void shell.openPath(dirname(log.transports.file.getFile().path))
  })
  ipcMain.handle(IPC.windowMinimize, () => win?.minimize())
  ipcMain.handle(IPC.windowClose, () => win?.close())
  ipcMain.handle(IPC.updaterInstall, () => updater.install())

  // ---- window & lifecycle ----
  win = createMainWindow()
  updater.check()

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.on('window-all-closed', () => app.quit())
}

async function detectGamePath(): Promise<string> {
  const candidates: string[] = []
  if (process.env['YUFA_GAME_DIR']) candidates.push(process.env['YUFA_GAME_DIR'])
  // launcher installed inside the game folder (or one level below it)
  const exeDir = dirname(app.getPath('exe'))
  candidates.push(exeDir, join(exeDir, '..'), join(exeDir, '..', '..'))
  candidates.push(DEFAULT_GAME_DIR)
  for (const c of candidates) {
    if (await isValidGameDir(c)) return c
  }
  return ''
}
