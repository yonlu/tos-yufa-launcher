import { describe, expect, it } from 'vitest'
import type { DxvkResult, UpdaterStatusEvent } from '@yufa/shared'
import { compatibilityFixRowResult, settingsSectionFromView, updaterControl } from '../src/renderer/src/lib/settingsDialog'

describe('settingsSectionFromView', () => {
  it('opens the Game section for a bare settings view', () => {
    expect(settingsSectionFromView('settings')).toBe('game')
  })

  it('opens the section named after the colon', () => {
    expect(settingsSectionFromView('settings:launcher')).toBe('launcher')
    expect(settingsSectionFromView('settings:game')).toBe('game')
  })

  it('is null without a settings view, and for a section it does not know', () => {
    expect(settingsSectionFromView(null)).toBeNull()
    expect(settingsSectionFromView('')).toBeNull()
    expect(settingsSectionFromView('news')).toBeNull()
    expect(settingsSectionFromView('settings:account')).toBeNull()
  })
})

describe('updaterControl', () => {
  it('offers Restart now once the update is downloaded', () => {
    expect(updaterControl('ready')).toEqual({ action: 'restart' })
  })

  it('offers Check now when main would act on it', () => {
    expect(updaterControl('none')).toEqual({ action: 'check', enabled: true })
    expect(updaterControl('error')).toEqual({ action: 'check', enabled: true })
  })

  it('greys Check now while a check or download is in flight, as main ignores it then', () => {
    const busy: UpdaterStatusEvent['status'][] = ['checking', 'available', 'downloading']
    for (const status of busy) expect(updaterControl(status)).toEqual({ action: 'check', enabled: false })
  })
})

describe('compatibilityFixRowResult', () => {
  const foreign: DxvkResult = { outcome: 'foreign', enabled: false, error: { code: 'foreign-dll', message: 'C:\\x\\release\\d3d9.dll' } }
  const blocked: DxvkResult = { outcome: 'foreign', enabled: true, error: { code: 'foreign-dll', message: 'C:\\x\\release\\d3d9.dll' } }
  const removed: DxvkResult = { outcome: 'removed', enabled: false }
  const present: DxvkResult = { outcome: 'present', enabled: true }

  it('shows what the last switch flip in this visit said, refusal or not', () => {
    expect(compatibilityFixRowResult({ visit: foreign, reconciled: undefined, enabled: false })).toBe(foreign)
    expect(compatibilityFixRowResult({ visit: removed, reconciled: blocked, enabled: false })).toBe(removed)
  })

  it('falls back to a refusal reconciling at ready reported, while the switch is on', () => {
    expect(compatibilityFixRowResult({ visit: null, reconciled: blocked, enabled: true })).toBe(blocked)
  })

  it('shows nothing for a reconcile that succeeded, one from before the switch went off, or nothing at all', () => {
    expect(compatibilityFixRowResult({ visit: null, reconciled: present, enabled: true })).toBeNull()
    expect(compatibilityFixRowResult({ visit: null, reconciled: blocked, enabled: false })).toBeNull()
    expect(compatibilityFixRowResult({ visit: null, reconciled: undefined, enabled: true })).toBeNull()
  })
})
