import type { PatcherStateEvent } from '@yufa/shared'
import { dxvkReason } from './compatibilityFix'
import { settingsSectionFromView } from './settingsDialog'

/** The three views the top bar switches between: Home, the full news list, and Settings. */
export type ShellView = 'home' | 'news' | 'settings'

/**
 * What `?view=` opens on start: `news` the News view, `settings` or
 * `settings:<section>` the Settings view (settingsSectionFromView names the
 * section), anything else Home. The screenshot smoke (YUFA_VIEW in main)
 * and the dev harness use it.
 */
export function shellViewFromQuery(view: string | null): ShellView {
  if (view === 'news') return 'news'
  return settingsSectionFromView(view) ? 'settings' : 'home'
}

/**
 * What takes the headline's slot. Each predicate is the one its component
 * renders by, so the headline and the components cannot drift.
 */

/** The install form: the game is not installed, or an interrupted install waits in the configured folder. */
export function installPanelUp(patcher: PatcherStateEvent): boolean {
  return patcher.state === 'not-installed' || (patcher.state === 'update-available' && patcher.installIncomplete === true)
}

/** The error notice: an error state that came with something to say. */
export function errorBannerShown(patcher: PatcherStateEvent): boolean {
  return patcher.state === 'error' && patcher.error !== undefined
}

/** The Redistributable warning: the last runtime install failed or was declined. */
export function runtimeWarningShown(patcher: PatcherStateEvent): boolean {
  return patcher.redist?.status === 'failed'
}

/** The Compatibility fix warning: reconciling at ready or before Play could not apply it. */
export function compatibilityFixWarningShown(patcher: PatcherStateEvent): boolean {
  return dxvkReason(patcher.dxvk) !== null
}

/**
 * The subtitle under the title stays only while nothing else needs its
 * place: the install form, a warning or an error takes it instead, so the
 * Play row stays where the eye expects it and the news below keeps its room.
 */
export function subtitleShown(patcher: PatcherStateEvent): boolean {
  return !(
    installPanelUp(patcher) ||
    errorBannerShown(patcher) ||
    runtimeWarningShown(patcher) ||
    compatibilityFixWarningShown(patcher)
  )
}
