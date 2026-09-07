import type { PatcherStateEvent } from '@yufa/shared'
import { dxvkReason } from './compatibilityFix'

/** The two in-launcher views the pill nav switches between. */
export type ShellView = 'home' | 'news'

/**
 * What `?view=` opens on start: `news` the News view, anything else Home.
 * The Settings views (`settings`, `settings:<section>`) are read by
 * settingsSectionFromView and open over Home. The screenshot smoke (YUFA_VIEW
 * in main) and the dev harness use it.
 */
export function shellViewFromQuery(view: string | null): ShellView {
  return view === 'news' ? 'news' : 'home'
}

/**
 * What takes the hero's slot. Each predicate is the one its component
 * renders by, so the hero's headline and the components cannot drift.
 */

/** The install panel: the game is not installed, or an interrupted install waits in the configured folder. */
export function installPanelUp(patcher: PatcherStateEvent): boolean {
  return patcher.state === 'not-installed' || (patcher.state === 'update-available' && patcher.installIncomplete === true)
}

/** The error banner: an error state that came with something to say. */
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

/** How much of the headline the hero shows: everything, the eyebrow and title only, or nothing. */
export type HeroHeadline = 'full' | 'title' | 'none'

/**
 * The headline gives way to whatever takes the hero's slot: entirely to the
 * install panel (with the folder's problems listed, even the eyebrow alone
 * would run 16 px into the nav pill at 1200 by 700), and its subtitle to a
 * banner or warning, so that even two of those at once leave Play in view.
 */
export function heroHeadline(patcher: PatcherStateEvent): HeroHeadline {
  if (installPanelUp(patcher)) return 'none'
  const warning = errorBannerShown(patcher) || runtimeWarningShown(patcher) || compatibilityFixWarningShown(patcher)
  return warning ? 'title' : 'full'
}
