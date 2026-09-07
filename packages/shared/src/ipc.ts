import type { NewsItem } from './manifest'
import type { RedistRuntime } from './redist'

/** Channel names shared by main, preload and renderer. */
export const IPC = {
  patcherCheck: 'patcher:check',
  patcherStart: 'patcher:start',
  patcherRepair: 'patcher:repair',
  patcherCancel: 'patcher:cancel',
  patcherCheckRuntimes: 'patcher:checkRuntimes',
  gameLaunch: 'game:launch',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSelectGamePath: 'settings:selectGamePath',
  installDefaultPath: 'install:defaultPath',
  installValidatePath: 'install:validatePath',
  installBrowse: 'install:browse',
  installStart: 'install:start',
  newsGet: 'news:get',
  appGetInfo: 'app:getInfo',
  appOpenExternal: 'app:openExternal',
  appOpenLogs: 'app:openLogs',
  windowMinimize: 'window:minimize',
  windowClose: 'window:close',
  updaterInstall: 'updater:install',
  updaterCheck: 'updater:check',
  dxvkEnable: 'dxvk:enable',
  dxvkDisable: 'dxvk:disable',
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
  | 'installing-runtimes'
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
  | 'redist-failed'
  /** A `release/d3d9.dll` the launcher did not put there (message: its path). The Compatibility fix leaves it alone. */
  | 'foreign-dll'
  /** The Compatibility fix could not be placed or removed for a reason other than the file being foreign. */
  | 'dxvk-failed'
  /** The patcher is mid-run; try again once it settles. */
  | 'busy'

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

/**
 * What the Redistributable flow is doing or last did. `downloading` and
 * `installing` accompany state 'installing-runtimes'; the rest ride on the
 * state the launcher returns to and stay until the next check. `failed`
 * is a warning: Play is still offered.
 */
export interface RedistStatus {
  status: 'downloading' | 'installing' | 'present' | 'installed' | 'failed'
  /** Runtimes the probe found missing (empty when all were present). */
  missing: RedistRuntime[]
  /** With status 'failed': `elevation-declined` when the UAC prompt was refused, else `redist-failed`. */
  error?: ErrorInfo
}

/**
 * What one Compatibility fix operation (CONTEXT.md, ADR 0003) did to
 * `release/d3d9.dll`. `installed`, `upgraded` and `present` are enable
 * outcomes; `removed` and `absent` are disable outcomes; `foreign` means a
 * file the launcher does not recognise sits there and was left alone;
 * `failed` means the operation was refused (game running, patcher busy) or
 * hit a filesystem error. Never a block on Play.
 */
export type DxvkOutcome = 'installed' | 'upgraded' | 'present' | 'removed' | 'absent' | 'foreign' | 'failed'

export interface DxvkResult {
  outcome: DxvkOutcome
  /** The switch (Settings' amdCompatibilityEnabled) after the operation. */
  enabled: boolean
  /** With `foreign`: foreign-dll and the file's path. With `failed`: game-running, busy, file-locked or dxvk-failed. */
  error?: ErrorInfo
}

export interface PatcherStateEvent {
  state: PatcherStateName
  error?: ErrorInfo
  redist?: RedistStatus
  /** With state 'ready' or 'up-to-date' and the Compatibility fix switched on: what reconciling it did. */
  dxvk?: DxvkResult
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
  /**
   * Chromium's GPU compositing for the launcher window itself, not the game. Off is the answer to a black or
   * flickering window on an old or flaky GPU. Applied once, before `app.whenReady`, so a change needs a restart.
   */
  hardwareAcceleration: boolean
  /** The Compatibility fix (ADR 0003) is on. The switch is the only state; the file follows it. */
  amdCompatibilityEnabled: boolean
  /** The one-time AMD prompt has been answered, either way. */
  amdCompatibilityPrompted: boolean
}

/** What `settings:set` answers: the sanitised settings, and whether a saved value only takes effect after a restart. */
export interface SettingsSetResult {
  settings: Settings
  /** `hardwareAcceleration` now differs from the value this process started with. */
  restartRequired: boolean
}

/** One adapter from `app.getGPUInfo('basic')`, PCI ids normalised to lowercase `0x` hex; null when unreadable. */
export interface GpuAdapter {
  vendorId: string | null
  deviceId: string | null
  /** Electron's `active` flag: the adapter Chromium renders on. A hybrid laptop lists the other one as inactive. */
  active: boolean
  /** PCI vendor 0x1002. */
  amd: boolean
  /** Electron's `deviceString` when it reports one; null in a basic probe that lacks it. */
  name: string | null
}

/** Whether the Compatibility fix should be offered. Any listed AMD adapter counts, active or not. */
export interface GpuDetection {
  amdDetected: boolean
  adapters: GpuAdapter[]
}

/** What the renderer learns about this run once, at startup. */
export interface AppInfo {
  version: string
  gpu: GpuDetection
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
  /** The Compatibility fix is reconciled before the client starts; with the switch on, what that did. A warning at most. */
  dxvk?: DxvkResult
}

/** The surface preload exposes as window.yufa. */
export interface YufaApi {
  patcherCheck(): Promise<PatcherStateEvent>
  patcherStart(): Promise<void>
  patcherRepair(): Promise<void>
  patcherCancel(): Promise<void>
  /** Settings action: probe the Windows runtimes again and install what is missing. */
  patcherCheckRuntimes(): Promise<void>
  gameLaunch(): Promise<LaunchResult>
  settingsGet(): Promise<Settings>
  settingsSet(partial: Partial<Settings>): Promise<SettingsSetResult>
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
  appGetInfo(): Promise<AppInfo>
  appOpenExternal(url: string): Promise<void>
  appOpenLogs(): Promise<void>
  windowMinimize(): void
  windowClose(): void
  updaterInstall(): Promise<void>
  /** Settings' Check now: asks the feed again. Ignored while a check or download is in flight. */
  updaterCheck(): Promise<void>
  /** Switches the Compatibility fix on: places `release/d3d9.dll` and sets the flag, or says why not. */
  dxvkEnable(): Promise<DxvkResult>
  /** Switches the Compatibility fix off: clears the flag and removes the file when it is the launcher's own. */
  dxvkDisable(): Promise<DxvkResult>
  onPatcherState(cb: (e: PatcherStateEvent) => void): () => void
  onPatcherProgress(cb: (e: PatcherProgressEvent) => void): () => void
  onUpdaterStatus(cb: (e: UpdaterStatusEvent) => void): () => void
}
