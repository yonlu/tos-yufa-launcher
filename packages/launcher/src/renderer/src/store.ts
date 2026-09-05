import { create } from 'zustand'
import type {
  InstallPathCheck,
  NewsResult,
  PatcherProgressEvent,
  PatcherStateEvent,
  Settings,
  UpdaterStatusEvent,
} from '@yufa/shared'
import i18n from './i18n'

/** Typing pauses this long before the main process is asked about the folder. */
const VALIDATE_DEBOUNCE_MS = 250

interface LauncherStore {
  patcher: PatcherStateEvent
  progress: PatcherProgressEvent | null
  updater: UpdaterStatusEvent
  settings: Settings | null
  news: NewsResult | null
  version: string
  launching: boolean
  initialized: boolean
  /** Install panel: the folder in the field, and what the main process last said about it. */
  installPath: string
  installCheck: InstallPathCheck | null
  installChecking: boolean
  init(): Promise<void>
  check(): Promise<void>
  startUpdate(): Promise<void>
  repair(): Promise<void>
  checkRuntimes(): Promise<void>
  cancel(): Promise<void>
  play(): Promise<void>
  saveSettings(p: Partial<Settings>): Promise<void>
  selectGamePath(): Promise<{ path: string; valid: boolean } | null>
  setInstallPath(path: string): void
  browseInstallPath(): Promise<void>
  startInstall(): Promise<void>
}

let validateTimer: ReturnType<typeof setTimeout> | undefined
let validateSeq = 0

export const useLauncher = create<LauncherStore>((set, get) => ({
  patcher: { state: 'idle' },
  progress: null,
  updater: { status: 'none' },
  settings: null,
  news: null,
  version: '',
  launching: false,
  initialized: false,
  installPath: '',
  installCheck: null,
  installChecking: false,

  async init() {
    if (get().initialized) return
    set({ initialized: true })
    const yufa = window.yufa

    yufa.onPatcherState((e) => {
      set((s) => ({
        patcher: e,
        progress:
          e.state === 'installing' ||
          e.state === 'updating' ||
          e.state === 'repairing' ||
          e.state === 'verifying' ||
          e.state === 'installing-runtimes'
            ? s.progress
            : null,
      }))
      // a cancelled run lands on idle; re-check so the panel or the Update/Resume button comes back
      if (e.state === 'idle') void get().check()
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
    if (e.state === 'not-installed') {
      // prefill once with the configured folder (the publisher default on a
      // first run); re-judge it now that the Current Manifest is known
      const path = get().installPath || get().settings?.gamePath || (await window.yufa.installDefaultPath())
      get().setInstallPath(path)
    }
  },

  startUpdate: () => window.yufa.patcherStart(),
  repair: () => window.yufa.patcherRepair(),
  checkRuntimes: () => window.yufa.patcherCheckRuntimes(),
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
    const result = await window.yufa.settingsSelectGamePath(i18n.t('settings.browseTitle'))
    if (result?.valid) {
      set({ settings: await window.yufa.settingsGet(), installPath: result.path })
      await get().check()
    }
    return result
  },

  setInstallPath(path) {
    set({ installPath: path, installChecking: true })
    clearTimeout(validateTimer)
    const seq = ++validateSeq
    validateTimer = setTimeout(async () => {
      const check = await window.yufa.installValidatePath(path)
      if (seq === validateSeq) set({ installCheck: check, installChecking: false })
    }, VALIDATE_DEBOUNCE_MS)
  },

  async browseInstallPath() {
    const chosen = await window.yufa.installBrowse(get().installPath, i18n.t('install.browseTitle'))
    if (chosen) get().setInstallPath(chosen)
  },

  async startInstall() {
    const { installPath, installCheck } = get()
    if (!installCheck?.ok || installCheck.path !== installPath) return
    await window.yufa.installStart(installPath)
    set({ settings: await window.yufa.settingsGet() })
  },
}))
