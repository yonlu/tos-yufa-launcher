import type {
  PatcherProgressEvent,
  PatcherStateEvent,
  Settings,
  UpdaterStatusEvent,
  YufaApi,
} from '@yufa/shared'

/**
 * Browser/dev harness: installed only when the preload bridge is absent.
 * Drive states via the URL, e.g. ?mock=updating, ?mock=error&code=offline —
 * lets every UI state be exercised without Electron or a patch server.
 */
export function installMockIfNeeded(): void {
  if (window.yufa) return

  const params = new URLSearchParams(location.search)
  const scenario = params.get('mock') ?? 'update-available'
  const errorCode = (params.get('code') ?? 'offline') as never

  const stateListeners = new Set<(e: PatcherStateEvent) => void>()
  const progressListeners = new Set<(e: PatcherProgressEvent) => void>()
  const updaterListeners = new Set<(e: UpdaterStatusEvent) => void>()

  const settings: Settings = {
    gamePath: 'C:\\tos-servers\\Classic',
    language: (params.get('lang') as 'pt-BR' | 'en') ?? 'pt-BR',
    launchArgs: '-SERVICE /S',
    afterLaunch: 'quit',
    downloadConcurrency: 1,
    allowOfflinePlay: true,
  }

  const plan = { fileCount: 3, deleteCount: 0, totalBytes: 157_286_400, targetRevision: 234932, localRevision: 234929 }

  function emitState(e: PatcherStateEvent): void {
    stateListeners.forEach((cb) => cb(e))
  }

  function simulateUpdate(): void {
    emitState({ state: 'updating', plan })
    let bytes = 0
    const total = plan.totalBytes
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
        setTimeout(() => emitState({ state: 'ready', plan }), 600)
      }
    }, 250)
  }

  const checkResult = (): PatcherStateEvent => {
    switch (scenario) {
      case 'up-to-date':
        return { state: 'up-to-date', plan: { ...plan, fileCount: 0, totalBytes: 0 } }
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
    patcherStart: async () => simulateUpdate(),
    patcherRepair: async () => {
      emitState({ state: 'repairing' })
      setTimeout(() => simulateUpdate(), 1200)
    },
    patcherCancel: async () => emitState({ state: 'idle' }),
    gameLaunch: async () => {
      console.log('[mock] launch game')
      return { ok: true }
    },
    settingsGet: async () => settings,
    settingsSet: async (p) => Object.assign(settings, p),
    settingsSelectGamePath: async () => ({ path: 'C:\\mock\\path', valid: params.get('badpath') === null }),
    newsGet: async () => ({
      stale: params.has('stalenews'),
      items: [
        {
          id: '1',
          date: '2026-07-01',
          pinned: true,
          title: { 'pt-BR': 'Novo launcher!', en: 'New launcher!' },
          body: {
            'pt-BR': 'Bem-vindo ao novo launcher do Yufa ToS Classic. Atualizações agora são automáticas.',
            en: 'Welcome to the new Yufa ToS Classic launcher. Updates are now automatic.',
          },
          url: 'https://example.com',
        },
        {
          id: '2',
          date: '2026-06-28',
          pinned: false,
          title: { 'pt-BR': 'Evento de EXP em dobro', en: 'Double EXP event' },
          body: { 'pt-BR': 'Até 07/07, EXP em dobro em todos os mapas!', en: 'Until Jul 7, double EXP on all maps!' },
        },
      ],
    }),
    appGetVersion: async () => '1.0.0-mock',
    appOpenExternal: async (url) => void window.open(url, '_blank'),
    appOpenLogs: async () => console.log('[mock] open logs'),
    windowMinimize: () => console.log('[mock] minimize'),
    windowClose: () => console.log('[mock] close'),
    updaterInstall: async () => console.log('[mock] quitAndInstall'),
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
