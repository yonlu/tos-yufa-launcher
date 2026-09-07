import type { DxvkResult, UpdaterStatusEvent } from '@yufa/shared'

/** The two panes of the Settings dialog, in sidebar order. */
export type SettingsSection = 'game' | 'launcher'
export const SETTINGS_SECTIONS: readonly SettingsSection[] = ['game', 'launcher']

/**
 * What `?view=` asks for on start: `settings` opens the Game section,
 * `settings:<section>` the named one. The screenshot smoke (YUFA_VIEW in
 * main) and the dev harness use it. Null for anything else.
 */
export function settingsSectionFromView(view: string | null): SettingsSection | null {
  if (view === 'settings') return 'game'
  if (!view?.startsWith('settings:')) return null
  const section = view.slice('settings:'.length)
  return SETTINGS_SECTIONS.find((s) => s === section) ?? null
}

/**
 * The control next to the launcher version: Restart now once an update is
 * downloaded; Check now otherwise, greyed while main would ignore it (a
 * check or a download already in flight).
 */
export type UpdaterControl = { action: 'restart' } | { action: 'check'; enabled: boolean }

const CHECK_IGNORED: ReadonlySet<UpdaterStatusEvent['status']> = new Set(['checking', 'available', 'downloading'])

export function updaterControl(status: UpdaterStatusEvent['status']): UpdaterControl {
  if (status === 'ready') return { action: 'restart' }
  return { action: 'check', enabled: !CHECK_IGNORED.has(status) }
}

/**
 * What the Compatibility fix row explains under the switch: the last enable
 * or disable of this visit, when there was one; otherwise the refusal
 * reconciling at ready reported (a foreign d3d9.dll blocking a switch that
 * is on), which only means something while the switch is still on.
 */
export function compatibilityFixRowResult(input: {
  visit: DxvkResult | null
  reconciled: DxvkResult | undefined
  enabled: boolean
}): DxvkResult | null {
  const { visit, reconciled, enabled } = input
  if (visit) return visit
  return enabled && reconciled?.error ? reconciled : null
}
