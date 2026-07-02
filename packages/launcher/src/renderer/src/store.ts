import { create } from 'zustand'
import type {
  NewsResult,
  PatcherProgressEvent,
  PatcherStateEvent,
  Settings,
  UpdaterStatusEvent,
} from '@yufa/shared'
import i18n from './i18n'

interface LauncherStore {
  patcher: PatcherStateEvent
  progress: PatcherProgressEvent | null
  updater: UpdaterStatusEvent
  settings: Settings | null
  news: NewsResult | null
  version: string
  launching: boolean
  initialized: boolean
  init(): Promise<void>
  check(): Promise<void>
  startUpdate(): Promise<void>
  repair(): Promise<void>
  cancel(): Promise<void>
  play(): Promise<void>
  saveSettings(p: Partial<Settings>): Promise<void>
  selectGamePath(): Promise<{ path: string; valid: boolean } | null>
}

export const useLauncher = create<LauncherStore>((set, get) => ({
  patcher: { state: 'idle' },
  progress: null,
  updater: { status: 'none' },
  settings: null,
  news: null,
  version: '',
  launching: false,
  initialized: false,

  async init() {
    if (get().initialized) return
    set({ initialized: true })
    const yufa = window.yufa

    yufa.onPatcherState((e) => {
      set((s) => ({
        patcher: e,
        progress: e.state === 'updating' || e.state === 'repairing' || e.state === 'verifying' ? s.progress : null,
      }))
    })
    yufa.onPatcherProgress((e) => set({ progress: e }))
    yufa.onUpdaterStatus((e) => set({ updater: e }))

    const [settings, version] = await Promise.all([yufa.settingsGet(), yufa.appGetVersion()])
    set({ settings, version })
    await i18n.changeLanguage(settings.language)

    await get().check()
    void yufa.newsGet().then((news) => set({ news }))
  },

  async check() {
    const e = await window.yufa.patcherCheck()
    set({ patcher: e })
  },

  startUpdate: () => window.yufa.patcherStart(),
  repair: () => window.yufa.patcherRepair(),
  cancel: () => window.yufa.patcherCancel(),

  async play() {
    set({ launching: true })
    const result = await window.yufa.gameLaunch()
    if (!result.ok) {
      set({ launching: false })
      if (result.error) set({ patcher: { state: 'error', error: result.error } })
    }
  },

  async saveSettings(partial) {
    const settings = await window.yufa.settingsSet(partial)
    set({ settings })
    if (partial.language) await i18n.changeLanguage(settings.language)
    if (partial.gamePath !== undefined) await get().check()
  },

  async selectGamePath() {
    const result = await window.yufa.settingsSelectGamePath()
    if (result?.valid) {
      set({ settings: await window.yufa.settingsGet() })
      await get().check()
    }
    return result
  },
}))
