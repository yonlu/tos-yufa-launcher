import type { NewsItem } from './manifest'

/** Channel names shared by main, preload and renderer. */
export const IPC = {
  patcherCheck: 'patcher:check',
  patcherStart: 'patcher:start',
  patcherRepair: 'patcher:repair',
  patcherCancel: 'patcher:cancel',
  gameLaunch: 'game:launch',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSelectGamePath: 'settings:selectGamePath',
  installDefaultPath: 'install:defaultPath',
  installValidatePath: 'install:validatePath',
  installBrowse: 'install:browse',
  installStart: 'install:start',
  newsGet: 'news:get',
  appGetVersion: 'app:getVersion',
  appOpenExternal: 'app:openExternal',
  appOpenLogs: 'app:openLogs',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  updaterInstall: 'updater:install',
  // main → renderer events
  patcherState: 'patcher:state',
  patcherProgress: 'patcher:progress',
  updaterStatus: 'updater:status',
} as const

export type PatcherStateName =
  | 'idle'
  | 'checking'
  | 'not-installed'
  | 'installing'
  | 'update-available'
  | 'up-to-date'
  | 'updating'
  | 'verifying'
  | 'repairing'
  | 'ready'
  | 'error'

export type ErrorCode =
  | 'offline'
  | 'manifest-invalid'
  | 'launcher-outdated'
  | 'disk-full'
  | 'file-locked'
  | 'game-running'
  | 'manifest-cdn-desync'
  | 'bad-game-path'
  | 'patch-dir-readonly'
  | 'download-failed'
  | 'av-suspected'
  | 'elevation-declined'

export interface ErrorInfo {
  code: ErrorCode
  message?: string
  detail?: string
}

export interface PlanSummary {
  /** Files to fetch: Managed Files plus Seed-once Files to write. */
  fileCount: number
  deleteCount: number
  totalBytes: number
  targetRevision: number
  /** What release.revision.txt said before the plan (0 when absent). */
  localRevision: number
}

export interface PatcherStateEvent {
  state: PatcherStateName
  error?: ErrorInfo
  /** With state 'error' code 'offline': the Install Record says the Build is complete, Play may be offered. */
  offlinePlayable?: boolean
  /** With state 'update-available': the Install Record is not complete, so this update finishes an interrupted install. */
  installIncomplete?: boolean
  plan?: PlanSummary
}

export interface PatcherProgressEvent {
  phase: 'hashing' | 'downloading'
  file: string
  fileIndex: number
  fileCount: number
  fileBytes: number
  fileTotal: number
  overallBytes: number
  overallTotal: number
  bytesPerSec: number
  etaSec: number | null
}

/** Why a candidate install folder cannot be used; a folder may fail for several reasons at once. */
export type InstallPathProblem = 'invalid' | 'forbidden' | 'not-writable' | 'not-enough-space' | 'no-manifest'

/** What the main process learned about a candidate install folder. */
export interface InstallPathCheck {
  path: string
  /** True when `problems` is empty: Install may start here. */
  ok: boolean
  problems: InstallPathProblem[]
  /** Free bytes on the drive the folder lives on; null when the drive could not be read. */
  freeBytes: number | null
  /** Bytes the whole Build needs plus the safety margin; null without a Current Manifest. */
  requiredBytes: number | null
  /** What the folder already holds: an unfinished Install Record or a bare client is `partial`. */
  existing: 'none' | 'partial' | 'complete'
}

export interface Settings {
  gamePath: string
  language: 'pt-BR' | 'en'
  launchArgs: string
  afterLaunch: 'quit' | 'minimize' | 'stay'
  downloadConcurrency: 1 | 2 | 3
  allowOfflinePlay: boolean
}

export interface UpdaterStatusEvent {
  status: 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
}

export interface NewsResult {
  items: NewsItem[]
  stale: boolean
}

export interface LaunchResult {
  ok: boolean
  error?: ErrorInfo
}

/** The surface preload exposes as window.yufa. */
export interface YufaApi {
  patcherCheck(): Promise<PatcherStateEvent>
  patcherStart(): Promise<void>
  patcherRepair(): Promise<void>
  patcherCancel(): Promise<void>
  gameLaunch(): Promise<LaunchResult>
  settingsGet(): Promise<Settings>
  settingsSet(partial: Partial<Settings>): Promise<Settings>
  /** "Locate existing install": directory picker titled by the renderer's locale; adopts the folder when valid. */
  settingsSelectGamePath(title: string): Promise<{ path: string; valid: boolean } | null>
  /** The publisher-conventional folder a first install is offered in. */
  installDefaultPath(): Promise<string>
  installValidatePath(path: string): Promise<InstallPathCheck>
  /** Directory picker for the install panel, titled by the renderer's locale; null when dismissed. Does not touch settings. */
  installBrowse(current: string, title: string): Promise<string | null>
  /** Makes `path` the game folder and installs the Current Manifest into it, or resumes what is there. */
  installStart(path: string): Promise<void>
  newsGet(): Promise<NewsResult>
  appGetVersion(): Promise<string>
  appOpenExternal(url: string): Promise<void>
  appOpenLogs(): Promise<void>
  windowMinimize(): void
  windowClose(): void
  updaterInstall(): Promise<void>
  onPatcherState(cb: (e: PatcherStateEvent) => void): () => void
  onPatcherProgress(cb: (e: PatcherProgressEvent) => void): () => void
  onUpdaterStatus(cb: (e: UpdaterStatusEvent) => void): () => void
}
