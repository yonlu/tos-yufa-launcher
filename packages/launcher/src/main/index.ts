import { dirname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import log from 'electron-log/main'
import {
  IPC,
  type AppInfo,
  type DxvkResult,
  type ErrorInfo,
  type GpuDetection,
  type LaunchResult,
  type PatcherProgressEvent,
  type PatcherStateEvent,
  type RedistStatus,
  type Settings,
  type SettingsSetResult,
} from '@yufa/shared'
import { bootSettings } from './boot'
import { bundledDxvkPath } from './bundledDxvk'
import { DEFAULT_INSTALL_DIR, FALLBACK_NEWS_URL, LAUNCHER_FEED_URL, MANIFEST_URL, REDIST_INDEX_URL } from './constants'
import { Dxvk } from './dxvk'
import { isGameRunning, launchGame } from './game'
import { describeGpu, detectAmdGpu, noGpu } from './gpu'
import { validateInstallPath } from './installPath'
import { cleanupStaleParts, gamePaths, isValidGameDir, probeGameDirWritable } from './localState'
import { fetchNews } from './news'
import { Patcher } from './patcher'
import { ensureRedistributables, probeWindowsRuntimes, runInstallersElevated } from './redist'
import { initSelfUpdate, type SelfUpdater } from './selfUpdate'
import { createMainWindow } from './window'

// Before ready, synchronously (see bootSettings): the YUFA_USERDATA test hook, the settings store,
// hardware acceleration off when the player switched it off. Nothing here may await.
const boot = bootSettings(app, process.env)
const settings = boot.settings

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  log.initialize()
  log.info(
    `launcher ${app.getVersion()} starting (manifest: ${MANIFEST_URL}, hardware acceleration ${boot.hardwareAcceleration ? 'on' : 'off'})`,
  )

  // Kicked off now so the answer is usually in hand when the renderer asks for app info.
  // test/e2e hook: YUFA_GPU=amd lists an AMD adapter so the prompt and the switch can be photographed on any machine
  const gpuDetection = process.env['YUFA_GPU'] === 'amd' ? Promise.resolve(pretendAmdGpu()) : probeGpu()

  // Without a known game folder the install panel targets the publisher default.
  if (!settings.get().gamePath) {
    settings.set({ gamePath: (await detectGamePath()) || DEFAULT_INSTALL_DIR })
  }

  let win: BrowserWindow | null = null
  const send = (channel: string, payload: unknown): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const electronFetch = ((input: string | URL | Request, init?: RequestInit) =>
    net.fetch(input as string, init)) as typeof fetch

  // The Compatibility fix (ADR 0003). Reads the game folder and the switch
  // on every operation, so it outlives the patcher rebuilt on a folder change.
  const dxvk = new Dxvk({
    gameDir: () => settings.get().gamePath,
    bundledDll: bundledDxvkPath(app),
    flag: {
      get: () => settings.get().amdCompatibilityEnabled,
      set: (on) => void settings.set({ amdCompatibilityEnabled: on }),
    },
    isGameRunning,
    isPatcherBusy: () => patcher.busy,
  })

  let patcher = buildPatcher()
  // test/e2e hook: YUFA_DXVK=enable|disable flips the Compatibility fix before the window opens, the way the
  // switch would, so the smoke can assert release/ and photograph the switch in its new position
  const dxvkHook = process.env['YUFA_DXVK']
  if (dxvkHook === 'enable' || dxvkHook === 'disable') {
    const result = dxvkHook === 'enable' ? await dxvk.enable() : await dxvk.disable()
    log.info(`dxvk ${dxvkHook} (YUFA_DXVK):${describeDxvk(result)}`)
  }

  function buildPatcher(): Patcher {
    const gameDir = settings.get().gamePath
    return new Patcher({
      gameDir,
      manifestUrl: MANIFEST_URL,
      launcherVersion: app.getVersion(),
      fetchImpl: electronFetch,
      downloadConcurrency: () => settings.get().downloadConcurrency,
      isGameRunning,
      reconcileDxvk: () => dxvk.reconcile(),
      ensureRuntimes: (hooks) =>
        ensureRedistributables({
          probe: probeWindowsRuntimes,
          runner: runInstallersElevated,
          indexUrl: REDIST_INDEX_URL,
          tempDir: join(app.getPath('temp'), 'yufa-launcher', 'redist'),
          fetchImpl: electronFetch,
          ...hooks,
        }),
      onState: (e: PatcherStateEvent) => {
        log.info(
          `patcher: ${e.state}${describeError(e.error)}${e.redist ? describeRedist(e.redist) : ''}${e.dxvk ? describeDxvk(e.dxvk) : ''}`,
        )
        send(IPC.patcherState, e)
        // e2e hook: YUFA_AUTO=update installs/downloads on its own; =play also launches
        const auto = process.env['YUFA_AUTO']
        if (auto && e.state === 'update-available') setTimeout(() => void patcher.update(), 50)
        if (auto && e.state === 'not-installed') setTimeout(() => void patcher.install(), 50)
        if (auto === 'play' && (e.state === 'ready' || e.state === 'up-to-date')) {
          setTimeout(() => void doLaunch(), 250)
        }
      },
      onProgress: (e: PatcherProgressEvent) => send(IPC.patcherProgress, e),
    })
  }

  const updater: SelfUpdater = initSelfUpdate(LAUNCHER_FEED_URL, (e) => {
    log.info(`self-update: ${e.status}${e.version ? ` ${e.version}` : ''}`)
    send(IPC.updaterStatus, e)
  })

  // ---- IPC ----
  // A folder that is not a valid game folder is reported by the patcher as
  // not-installed; only an unset path is an error here (the install screen
  // that picks one is issue #6).
  ipcMain.handle(IPC.patcherCheck, async () => {
    const gameDir = settings.get().gamePath
    if (!gameDir) {
      const e: PatcherStateEvent = { state: 'error', error: { code: 'bad-game-path', message: gameDir } }
      send(IPC.patcherState, e)
      return e
    }
    if ((await isValidGameDir(gameDir)) && !(await probeGameDirWritable(gamePaths(gameDir)))) {
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
  ipcMain.handle(IPC.patcherCheckRuntimes, () => {
    void patcher.checkRuntimes()
  })

  async function doLaunch(): Promise<LaunchResult> {
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

    // The fix follows the switch right before the client loads d3d9.dll; a
    // failure here is a warning on the result, never a reason not to launch.
    const fix = await dxvk.reconcile()
    if (fix) log.info(`game launch:${describeDxvk(fix)}`)

    // test/e2e hook: launch a real client while patching runs against a sandbox game dir
    const paths = gamePaths(s.gamePath)
    const launchExe = process.env['YUFA_LAUNCH_EXE']
    if (launchExe) {
      paths.clientExe = launchExe
      paths.releaseDir = dirname(launchExe)
    }
    const result = await launchGame(paths, s.launchArgs)
    log.info(`game launch: ${result.ok ? 'ok' : `failed (${result.error?.message ?? ''})`}`)
    if (result.ok) {
      if (s.afterLaunch === 'quit') setTimeout(() => app.quit(), 1500)
      else if (s.afterLaunch === 'minimize') win?.minimize()
    }
    return fix ? { ...result, dxvk: fix } : result
  }

  ipcMain.handle(IPC.gameLaunch, () => doLaunch())

  ipcMain.handle(IPC.dxvkEnable, async (): Promise<DxvkResult> => {
    const result = await dxvk.enable()
    log.info(`dxvk enable:${describeDxvk(result)}`)
    return result
  })
  ipcMain.handle(IPC.dxvkDisable, async (): Promise<DxvkResult> => {
    const result = await dxvk.disable()
    log.info(`dxvk disable:${describeDxvk(result)}`)
    return result
  })

  ipcMain.handle(IPC.settingsGet, (): Settings => settings.get())
  ipcMain.handle(IPC.settingsSet, (_e, partial: Partial<Settings>): SettingsSetResult => {
    const before = settings.get().gamePath
    const after = settings.set(partial)
    if (after.gamePath !== before) patcher = buildPatcher()
    return { settings: after, restartRequired: boot.restartRequired() }
  })
  ipcMain.handle(IPC.settingsSelectGamePath, async (_e, title: string) => {
    const result = await dialog.showOpenDialog({
      title,
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

  // ---- first-run install ----
  /** Bytes of the whole Build, from the Current Manifest the last check loaded; null before one. */
  const buildBytes = (): number | null =>
    patcher.loadedManifest?.files.reduce((sum, f) => sum + f.size, 0) ?? null

  ipcMain.handle(IPC.installDefaultPath, () => DEFAULT_INSTALL_DIR)
  ipcMain.handle(IPC.installValidatePath, (_e, path: string) => validateInstallPath(path, buildBytes()))
  ipcMain.handle(IPC.installBrowse, async (_e, current: string, title: string) => {
    const result = await dialog.showOpenDialog({
      title,
      defaultPath: current || DEFAULT_INSTALL_DIR,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.installStart, async (_e, path: string) => {
    // The renderer only enables Install on an ok check; re-judge here so a
    // stale check can never send the patcher into Program Files or a
    // read-only drive. Space is left to the patcher's own disk-full path.
    const check = await validateInstallPath(path, buildBytes())
    const blocking = check.problems.filter((p) => p !== 'not-enough-space' && p !== 'no-manifest')
    if (blocking.length) {
      send(IPC.patcherState, {
        state: 'error',
        error: { code: blocking.includes('not-writable') ? 'patch-dir-readonly' : 'bad-game-path', message: path },
      } satisfies PatcherStateEvent)
      return
    }
    const gamePath = resolve(path.trim()) // what validation judged, not the raw field text
    if (gamePath !== settings.get().gamePath) {
      settings.set({ gamePath })
      patcher = buildPatcher()
    }
    log.info(`install requested into ${gamePath}`)
    void patcher.installOrResume()
  })

  ipcMain.handle(IPC.newsGet, () => {
    const newsUrl = patcher.loadedManifest?.newsUrl ?? FALLBACK_NEWS_URL
    return fetchNews(newsUrl, join(app.getPath('userData'), 'news-cache.json'), electronFetch)
  })

  ipcMain.handle(IPC.appGetInfo, async (): Promise<AppInfo> => ({ version: app.getVersion(), gpu: await gpuDetection }))
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

  // CI/dev smoke hook: capture the rendered window and exit
  const screenshotPath = process.env['YUFA_SCREENSHOT']
  if (screenshotPath) {
    setTimeout(async () => {
      try {
        const image = await win!.webContents.capturePage()
        const { promises: fsp } = await import('node:fs')
        await fsp.writeFile(screenshotPath, image.toPNG())
        log.info(`screenshot written to ${screenshotPath}`)
      } catch (err) {
        log.error('screenshot failed', err)
      } finally {
        app.quit()
      }
    }, Number(process.env['YUFA_SCREENSHOT_DELAY'] ?? 4500))
  }

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.on('window-all-closed', () => app.quit())
}

function describeError(error: ErrorInfo | undefined): string {
  return error ? ` (${error.code}: ${error.message ?? ''})` : ''
}

function describeRedist(r: RedistStatus): string {
  return ` [runtimes ${r.status}${r.missing.length ? ` ${r.missing.join('+')}` : ''}${describeError(r.error)}]`
}

function describeDxvk(d: DxvkResult): string {
  return ` [dxvk ${d.outcome}, switch ${d.enabled ? 'on' : 'off'}${describeError(d.error)}]`
}

async function detectGamePath(): Promise<string> {
  // test/e2e hook: the sandbox folder is the game folder even while still empty
  if (process.env['YUFA_GAME_DIR']) return process.env['YUFA_GAME_DIR']
  // launcher installed inside the game folder (or one level below it)
  const exeDir = dirname(app.getPath('exe'))
  const candidates = [exeDir, join(exeDir, '..'), join(exeDir, '..', '..'), DEFAULT_INSTALL_DIR]
  for (const c of candidates) {
    if (await isValidGameDir(c)) return c
  }
  return ''
}

/** What YUFA_GPU=amd reports: one AMD adapter, named so a screenshot says where it came from. */
function pretendAmdGpu(): GpuDetection {
  return {
    amdDetected: true,
    adapters: [{ vendorId: '0x1002', deviceId: null, active: true, amd: true, name: 'AMD Radeon (YUFA_GPU=amd)' }],
  }
}

/** How long the GPU probe may hold up app info before the launcher assumes no AMD adapter. */
const GPU_INFO_TIMEOUT_MS = 5000

/**
 * The Compatibility fix's detection (ADR 0003): Chromium's own GPU list, no
 * WMI, no elevation. A probe that fails or stalls yields no AMD and a log
 * line; the switch in Settings still works by hand.
 */
async function probeGpu(): Promise<GpuDetection> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const info = await Promise.race([
      app.getGPUInfo('basic'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${GPU_INFO_TIMEOUT_MS} ms`)), GPU_INFO_TIMEOUT_MS)
      }),
    ])
    const result = detectAmdGpu(info)
    log.info(`gpu: ${describeGpu(result)}`)
    return result
  } catch (err) {
    log.warn(`gpu: probe failed (${err instanceof Error ? err.message : String(err)}); assuming no AMD adapter`)
    return noGpu()
  } finally {
    clearTimeout(timer)
  }
}
