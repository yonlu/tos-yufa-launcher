import { describe, expect, it } from 'vitest'
import type { PatcherStateEvent } from '@yufa/shared'
import { heroHeadline, installPanelUp, shellViewFromQuery } from '../src/renderer/src/lib/shell'

const event = (partial: Partial<PatcherStateEvent> & Pick<PatcherStateEvent, 'state'>): PatcherStateEvent => partial

describe('shellViewFromQuery', () => {
  it('opens the News view when asked', () => {
    expect(shellViewFromQuery('news')).toBe('news')
  })

  it('opens Home otherwise, the Settings views included', () => {
    expect(shellViewFromQuery(null)).toBe('home')
    expect(shellViewFromQuery('')).toBe('home')
    expect(shellViewFromQuery('home')).toBe('home')
    expect(shellViewFromQuery('settings')).toBe('home')
    expect(shellViewFromQuery('settings:launcher')).toBe('home')
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

describe('heroHeadline', () => {
  it('is the whole headline on a quiet launcher', () => {
    expect(heroHeadline(event({ state: 'up-to-date' }))).toBe('full')
    expect(heroHeadline(event({ state: 'updating' }))).toBe('full')
    expect(heroHeadline(event({ state: 'update-available' }))).toBe('full')
  })

  it('gives way to the install panel entirely', () => {
    expect(heroHeadline(event({ state: 'not-installed' }))).toBe('none')
    expect(heroHeadline(event({ state: 'update-available', installIncomplete: true }))).toBe('none')
  })

  it('drops the subtitle when a banner or warning takes the slot, so two of them still leave Play in view', () => {
    expect(heroHeadline(event({ state: 'error', error: { code: 'offline' } }))).toBe('title')
    expect(heroHeadline(event({ state: 'ready', redist: { status: 'failed', missing: ['directx'], error: { code: 'redist-failed' } } }))).toBe('title')
    expect(heroHeadline(event({ state: 'ready', dxvk: { outcome: 'foreign', enabled: true, error: { code: 'foreign-dll' } } }))).toBe('title')
  })

  it('keeps the subtitle for outcomes that show no warning, and for an error state with nothing to say', () => {
    expect(heroHeadline(event({ state: 'ready', redist: { status: 'installed', missing: ['directx'] } }))).toBe('full')
    expect(heroHeadline(event({ state: 'ready', dxvk: { outcome: 'present', enabled: true } }))).toBe('full')
    expect(heroHeadline(event({ state: 'error' }))).toBe('full')
  })
})
