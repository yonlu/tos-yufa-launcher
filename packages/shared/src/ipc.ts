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

export interface ErrorInfo {
  code: ErrorCode
  message?: string
  detail?: string
}

export interface PlanSummary {
  fileCount: number
  totalBytes: number
  targetRevision: number
  localRevision: number
}

export interface PatcherStateEvent {
  state: PatcherStateName
  error?: ErrorInfo
  /** With state 'error' code 'offline': a valid-looking local install exists, Play may be offered. */
  offlinePlayable?: boolean
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
  settingsSelectGamePath(): Promise<{ path: string; valid: boolean } | null>
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
