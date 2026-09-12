import type {
  DxvkResult,
  GpuDetection,
  InstallPathCheck,
  InstallPathProblem,
  PatcherProgressEvent,
  PatcherStateEvent,
  RedistStatus,
  Settings,
  UpdaterStatusEvent,
  YufaApi,
} from '@yufa/shared'

/**
 * Browser/dev harness: installed only when the preload bridge is absent.
 * Drive states via the URL, e.g. ?mock=updating, ?mock=error&code=offline,
 * ?mock=not-installed[&partial][&nospace], ?mock=resume, ?mock=runtimes, &redist=failed|declined
 * (warning on a ready launcher), &amd=1 (an AMD adapter in the GPU list; the prompt shows on ready unless
 * &prompted), &dxvk=on (the Compatibility fix switched on), &dxvk=foreign (a d3d9.dll the launcher does not
 * recognise makes enable refuse) or &dxvk=blocked (the switch on and that file in the way, so reconciling at ready
 * reports the refusal), &hwaccel=off (hardware acceleration switched off at "boot", so switching it back on asks
 * for a restart), &view=settings or &view=settings:launcher (the Settings view open on start, at that section),
 * &updater=checking|none|available|downloading|ready|error
 * (the launcher update status a second after start; Check now in Settings always runs checking then none),
 * &discord=off (the Discord counts fail, so the Discord line shows no number), &news=empty (a feed with
 * nothing in it), &stalenews (the feed came from the cache), &view=news (the News view open on start).
 * Every UI state can be exercised without Electron or a patch server.
 */
export function installMockIfNeeded(): void {
  if (window.yufa) return

  const params = new URLSearchParams(location.search)
  const scenario = params.get('mock') ?? 'update-available'
  const errorCode = (params.get('code') ?? 'offline') as never

  const stateListeners = new Set<(e: PatcherStateEvent) => void>()
  const progressListeners = new Set<(e: PatcherProgressEvent) => void>()
  const updaterListeners = new Set<(e: UpdaterStatusEvent) => void>()
  const emitUpdater = (e: UpdaterStatusEvent): void => updaterListeners.forEach((cb) => cb(e))

  const DEFAULT_INSTALL_DIR = 'C:\\Hyped Games\\ToS Classic'
  /** ?dxvk=on|foreign|blocked: the Compatibility fix switch on, someone else's d3d9.dll in the way, or both. */
  const dxvkMode = params.get('dxvk')
  const dxvkSwitchOn = dxvkMode === 'on' || dxvkMode === 'blocked'
  const dxvkForeignFile = dxvkMode === 'foreign' || dxvkMode === 'blocked'
  const settings: Settings = {
    gamePath: scenario === 'not-installed' ? DEFAULT_INSTALL_DIR : 'C:\\tos-servers\\Classic',
    language: (params.get('lang') as 'pt-BR' | 'en') ?? 'pt-BR',
    launchArgs: '-SERVICE /S',
    afterLaunch: 'quit',
    downloadConcurrency: 2,
    allowOfflinePlay: true,
    hardwareAcceleration: params.get('hwaccel') !== 'off',
    amdCompatibilityEnabled: dxvkSwitchOn,
    amdCompatibilityPrompted: params.has('prompted'),
  }

  /** What this "process" started with: the real main compares every save against it. */
  const bootHardwareAcceleration = settings.hardwareAcceleration

  /** ?amd=1 puts a Radeon next to the integrated adapter, the hybrid-laptop case the prompt exists for. */
  const gpu: GpuDetection = params.has('amd')
    ? {
        amdDetected: true,
        adapters: [
          { vendorId: '0x8086', deviceId: '0x9a49', active: true, amd: false, name: 'Intel(R) Iris(R) Xe Graphics' },
          { vendorId: '0x1002', deviceId: '0x73df', active: false, amd: true, name: 'AMD Radeon RX 6700 XT' },
        ],
      }
    : {
        amdDetected: false,
        adapters: [{ vendorId: '0x10de', deviceId: '0x2484', active: true, amd: false, name: 'NVIDIA GeForce RTX 3070' }],
      }

  /** The Compatibility fix on a fake release/: the switch is the only state, the foreign file refuses every operation. */
  const foreignDll = (): DxvkResult | null =>
    dxvkForeignFile
      ? {
          outcome: 'foreign',
          enabled: settings.amdCompatibilityEnabled,
          error: { code: 'foreign-dll', message: `${settings.gamePath}\\release\\d3d9.dll` },
        }
      : null
  const dxvkEnable = async (): Promise<DxvkResult> => {
    const foreign = foreignDll()
    if (foreign) return foreign
    const outcome = settings.amdCompatibilityEnabled ? 'present' : 'installed'
    settings.amdCompatibilityEnabled = true
    return { outcome, enabled: true }
  }
  const dxvkDisable = async (): Promise<DxvkResult> => {
    const was = settings.amdCompatibilityEnabled
    settings.amdCompatibilityEnabled = false
    return foreignDll() ?? { outcome: was ? 'removed' : 'absent', enabled: false }
  }
  /** What reconciling at ready reports: nothing with the switch off, else the same as an enable. */
  const dxvkReconcile = (): Promise<DxvkResult | undefined> =>
    settings.amdCompatibilityEnabled ? dxvkEnable() : Promise.resolve(undefined)
  /** What the state a check lands on carries: with the switch on, the file is there or something else is in its way. */
  const dxvkAtReady = (): DxvkResult | undefined =>
    settings.amdCompatibilityEnabled ? (foreignDll() ?? { outcome: 'present', enabled: true }) : undefined

  const plan = { fileCount: 3, deleteCount: 0, totalBytes: 157_286_400, targetRevision: 234932, localRevision: 234929 }
  const BUILD_BYTES = 13_400_000_000
  const fullPlan = { fileCount: 2140, deleteCount: 0, totalBytes: BUILD_BYTES, targetRevision: 234932, localRevision: 0 }

  function emitState(e: PatcherStateEvent): void {
    stateListeners.forEach((cb) => cb(e))
  }

  /** The warning a ready launcher shows after a failed runtime install (?redist=failed|declined). */
  function redistOutcome(): RedistStatus | undefined {
    const mode = params.get('redist')
    if (mode === 'failed') {
      return { status: 'failed', missing: ['directx'], error: { code: 'redist-failed', message: 'installer exit codes: directx=1' } }
    }
    if (mode === 'declined') {
      return { status: 'failed', missing: ['vcredist', 'directx'], error: { code: 'elevation-declined' } }
    }
    return undefined
  }

  /** Redistributable flow after an install: download two installers, then the elevated run, then ready. */
  function simulateRuntimes(after: PatcherStateEvent): void {
    const missing: RedistStatus['missing'] = ['vcredist', 'directx']
    emitState({ state: 'installing-runtimes', redist: { status: 'downloading', missing } })
    const total = 18_000_000
    let bytes = 0
    const timer = setInterval(() => {
      bytes = Math.min(total, bytes + total / 12)
      progressListeners.forEach((cb) =>
        cb({
          phase: 'downloading',
          file: bytes < total / 2 ? 'vc_redist.x86.exe' : 'DXSETUP.exe',
          fileIndex: bytes < total / 2 ? 1 : 2,
          fileCount: 2,
          fileBytes: bytes % (total / 2),
          fileTotal: total / 2,
          overallBytes: bytes,
          overallTotal: total,
          bytesPerSec: 6_500_000,
          etaSec: Math.round((total - bytes) / 6_500_000),
        }),
      )
      if (bytes >= total) {
        clearInterval(timer)
        emitState({ state: 'installing-runtimes', redist: { status: 'installing', missing } })
        setTimeout(() => emitState({ ...after, redist: redistOutcome() ?? { status: 'installed', missing } }), 2500)
      }
    }, 250)
  }

  function simulateDownload(state: 'installing' | 'updating', total: number): void {
    emitState({ state, plan: state === 'installing' ? fullPlan : plan })
    let bytes = 0
    const timer = setInterval(() => {
      bytes = Math.min(total, bytes + total / 40)
      progressListeners.forEach((cb) =>
        cb({
          phase: 'downloading',
          file: '234930_001001.ipf',
          fileIndex: Math.min(3, 1 + Math.floor((bytes / total) * 3)),
          fileCount: 3,
          fileBytes: bytes % (total / 3),
          fileTotal: total / 3,
          overallBytes: bytes,
          overallTotal: total,
          bytesPerSec: 6_500_000,
          etaSec: Math.round((total - bytes) / 6_500_000),
        }),
      )
      if (bytes >= total) {
        clearInterval(timer)
        emitState({ state: 'verifying' })
        const ready: PatcherStateEvent = { state: 'ready', plan }
        setTimeout(() => (state === 'installing' ? simulateRuntimes(ready) : emitState(ready)), 600)
      }
    }, 250)
  }

  /** Fake folder judgement: Program Files/Windows are forbidden, ?nospace starves the drive, ?partial finds an old install. */
  function judgePath(path: string): InstallPathCheck {
    const problems: InstallPathProblem[] = []
    if (!/^[A-Za-z]:[\\/]/.test(path)) problems.push('invalid')
    else {
      if (/program files|\\windows(\\|$)/i.test(path)) problems.push('forbidden')
      if (/locked/i.test(path)) problems.push('not-writable')
      if (params.has('nospace')) problems.push('not-enough-space')
    }
    return {
      path,
      ok: problems.length === 0,
      problems,
      freeBytes: params.has('nospace') ? 2_000_000_000 : 120_000_000_000,
      requiredBytes: BUILD_BYTES + 200 * 1024 * 1024,
      existing: params.has('partial') ? 'partial' : 'none',
    }
  }

  const checkResult = (): PatcherStateEvent => {
    switch (scenario) {
      case 'up-to-date':
        return { state: 'up-to-date', plan: { ...plan, fileCount: 0, totalBytes: 0 }, redist: redistOutcome(), dxvk: dxvkAtReady() }
      case 'runtimes':
        return { state: 'installing-runtimes', redist: { status: 'installing', missing: ['vcredist', 'directx'] } }
      case 'not-installed':
        return { state: 'not-installed', plan: fullPlan }
      case 'resume':
        return { state: 'update-available', installIncomplete: true, plan: { ...fullPlan, fileCount: 812 } }
      case 'error':
        return {
          state: 'error',
          error: { code: errorCode, message: 'mock error' },
          offlinePlayable: errorCode === 'offline',
        }
      default:
        return { state: 'update-available', plan }
    }
  }

  const api: YufaApi = {
    patcherCheck: async () => {
      emitState({ state: 'checking' })
      await new Promise((r) => setTimeout(r, 700))
      const e = checkResult()
      emitState(e)
      return e
    },
    patcherStart: async () => simulateDownload('updating', plan.totalBytes),
    patcherRepair: async () => {
      emitState({ state: 'repairing' })
      setTimeout(() => simulateDownload('updating', plan.totalBytes), 1200)
    },
    patcherCancel: async () => emitState({ state: 'idle' }),
    patcherCheckRuntimes: async () => simulateRuntimes(checkResult()),
    gameLaunch: async () => {
      console.log('[mock] launch game')
      const dxvk = await dxvkReconcile()
      return dxvk ? { ok: true, dxvk } : { ok: true }
    },
    settingsGet: async () => settings,
    settingsSet: async (p) => ({
      settings: Object.assign(settings, p),
      restartRequired: settings.hardwareAcceleration !== bootHardwareAcceleration,
    }),
    settingsSelectGamePath: async () => ({ path: 'C:\\mock\\path', valid: params.get('badpath') === null }),
    installDefaultPath: async () => DEFAULT_INSTALL_DIR,
    installValidatePath: async (path) => {
      await new Promise((r) => setTimeout(r, 300))
      return judgePath(path)
    },
    installBrowse: async (current) => (params.has('browsecancel') ? null : `${current || 'D:'}\\picked`),
    installStart: async (path) => {
      settings.gamePath = path
      console.log(`[mock] install into ${path}`)
      // the real main process checks first, then installs an empty folder or resumes (update path) a partial one
      emitState({ state: 'checking' })
      const resume = params.has('partial')
      setTimeout(() => simulateDownload(resume ? 'updating' : 'installing', fullPlan.totalBytes / (resume ? 3 : 1)), 500)
    },
    newsGet: async () => ({
      stale: params.has('stalenews'),
      posts:
        params.get('news') === 'empty'
          ? []
          : [
              {
                id: 3,
                slug: 'novo-launcher',
                title: 'Novo launcher!',
                category: 'announcement',
                excerpt: 'Bem-vindo ao novo launcher do Yufa ToS Classic. Atualizações agora são automáticas.',
                coverImage: null,
                pinned: true,
                publishedAt: Date.UTC(2026, 6, 1),
                url: 'https://tosclassic.com/news/novo-launcher',
              },
              {
                id: 2,
                slug: 'evento-exp-em-dobro',
                title: 'Evento de EXP em dobro',
                category: 'event',
                excerpt: 'Até 07/07, EXP em dobro em todos os mapas!',
                coverImage: null,
                pinned: false,
                publishedAt: Date.UTC(2026, 5, 28),
                url: 'https://tosclassic.com/news/evento-exp-em-dobro',
              },
              {
                id: 1,
                slug: 'manutencao-concluida',
                title: 'Manutenção concluída',
                category: 'maintenance',
                excerpt: 'O servidor voltou com a correção do lag em Fedimian e o balanceamento de classes da semana.',
                coverImage: null,
                pinned: false,
                publishedAt: Date.UTC(2026, 5, 20),
                url: 'https://tosclassic.com/news/manutencao-concluida',
              },
            ],
    }),
    communityGet: async () => (params.get('discord') === 'off' ? null : { online: 87, members: 2431 }),
    appGetInfo: async () => ({ version: '1.0.0-mock', gpu }),
    appOpenExternal: async (url) => void window.open(url, '_blank'),
    appOpenLogs: async () => console.log('[mock] open logs'),
    windowMinimize: () => console.log('[mock] minimize'),
    windowClose: () => console.log('[mock] close'),
    updaterInstall: async () => console.log('[mock] quitAndInstall'),
    updaterCheck: async () => {
      emitUpdater({ status: 'checking' })
      setTimeout(() => emitUpdater({ status: 'none' }), 1200)
    },
    dxvkEnable,
    dxvkDisable,
    onPatcherState: (cb) => {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },
    onPatcherProgress: (cb) => {
      progressListeners.add(cb)
      return () => progressListeners.delete(cb)
    },
    onUpdaterStatus: (cb) => {
      updaterListeners.add(cb)
      if (params.has('updater')) {
        setTimeout(() => cb({ status: params.get('updater') as never, version: '1.0.1', percent: 42 }), 1000)
      }
      return () => updaterListeners.delete(cb)
    },
  }

  window.yufa = api
}
