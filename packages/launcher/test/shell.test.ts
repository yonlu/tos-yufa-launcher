import { describe, expect, it } from 'vitest'
import type { PatcherStateEvent } from '@yufa/shared'
import { installPanelUp, shellViewFromQuery, subtitleShown } from '../src/renderer/src/lib/shell'

const event = (partial: Partial<PatcherStateEvent> & Pick<PatcherStateEvent, 'state'>): PatcherStateEvent => partial

describe('shellViewFromQuery', () => {
  it('opens the News view when asked', () => {
    expect(shellViewFromQuery('news')).toBe('news')
  })

  it('opens the Settings view for a settings query with a section it knows', () => {
    expect(shellViewFromQuery('settings')).toBe('settings')
    expect(shellViewFromQuery('settings:launcher')).toBe('settings')
    expect(shellViewFromQuery('settings:game')).toBe('settings')
  })

  it('opens Home otherwise, a settings section it does not know included', () => {
    expect(shellViewFromQuery(null)).toBe('home')
    expect(shellViewFromQuery('')).toBe('home')
    expect(shellViewFromQuery('home')).toBe('home')
    expect(shellViewFromQuery('settings:account')).toBe('home')
  })
})

describe('installPanelUp', () => {
  it('is up while the game is not installed', () => {
    expect(installPanelUp(event({ state: 'not-installed' }))).toBe(true)
  })

  it('is up while an interrupted install waits to be resumed', () => {
    expect(installPanelUp(event({ state: 'update-available', installIncomplete: true }))).toBe(true)
  })

  it('is down for an ordinary update, and every other state', () => {
    expect(installPanelUp(event({ state: 'update-available' }))).toBe(false)
    for (const state of ['idle', 'checking', 'installing', 'updating', 'ready', 'up-to-date', 'error'] as const) {
      expect(installPanelUp(event({ state }))).toBe(false)
    }
  })
})

describe('subtitleShown', () => {
  it('shows the subtitle on a quiet launcher', () => {
    expect(subtitleShown(event({ state: 'up-to-date' }))).toBe(true)
    expect(subtitleShown(event({ state: 'updating' }))).toBe(true)
    expect(subtitleShown(event({ state: 'update-available' }))).toBe(true)
  })

  it('gives its place to the install form', () => {
    expect(subtitleShown(event({ state: 'not-installed' }))).toBe(false)
    expect(subtitleShown(event({ state: 'update-available', installIncomplete: true }))).toBe(false)
  })

  it('gives its place to an error or a warning', () => {
    expect(subtitleShown(event({ state: 'error', error: { code: 'offline' } }))).toBe(false)
    expect(subtitleShown(event({ state: 'ready', redist: { status: 'failed', missing: ['directx'], error: { code: 'redist-failed' } } }))).toBe(false)
    expect(subtitleShown(event({ state: 'ready', dxvk: { outcome: 'foreign', enabled: true, error: { code: 'foreign-dll' } } }))).toBe(false)
  })

  it('stays for outcomes that show no warning, and for an error state with nothing to say', () => {
    expect(subtitleShown(event({ state: 'ready', redist: { status: 'installed', missing: ['directx'] } }))).toBe(true)
    expect(subtitleShown(event({ state: 'ready', dxvk: { outcome: 'present', enabled: true } }))).toBe(true)
    expect(subtitleShown(event({ state: 'error' }))).toBe(true)
  })
})
