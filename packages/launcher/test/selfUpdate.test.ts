import { describe, expect, it } from 'vitest'
import type { UpdaterStatusEvent } from '@yufa/shared'
import { createSelfUpdater, type UpdaterEngine } from '../src/main/selfUpdate'

/** Loose on purpose: one map holds listeners of every event shape. */
type Listener = (payload?: any) => void

interface FakeEngine {
  checks: number
  installs: number
  emit(event: string, payload?: unknown): void
}

/** An electron-updater stand-in: records calls, lets the test fire its events. */
function fakeEngine(behaviour: { reject?: boolean } = {}): UpdaterEngine & FakeEngine {
  const listeners = new Map<string, Listener>()
  const engine: UpdaterEngine & FakeEngine = {
    checks: 0,
    installs: 0,
    on(event: string, listener: Listener) {
      listeners.set(event, listener)
      return engine
    },
    async checkForUpdates() {
      engine.checks++
      if (behaviour.reject) throw new Error('feed unreachable')
      return null
    },
    quitAndInstall() {
      engine.installs++
    },
    emit(event: string, payload?: unknown) {
      listeners.get(event)?.(payload)
    },
  }
  return engine
}

const quietLog = { warn: () => {} }

function harness(behaviour?: { reject?: boolean }) {
  const engine = fakeEngine(behaviour)
  const statuses: UpdaterStatusEvent[] = []
  const updater = createSelfUpdater(engine, (e) => statuses.push(e), quietLog)
  return { engine, statuses, updater }
}

describe('createSelfUpdater without an engine (dev or unconfigured feed)', () => {
  it('answers a check with none right away and install does nothing', () => {
    const statuses: UpdaterStatusEvent[] = []
    const updater = createSelfUpdater(null, (e) => statuses.push(e), quietLog)
    updater.check()
    updater.install()
    expect(statuses).toEqual([{ status: 'none' }])
  })
})

describe('createSelfUpdater with an engine', () => {
  it('forwards check to the engine', () => {
    const { engine, updater } = harness()
    updater.check()
    expect(engine.checks).toBe(1)
  })

  it('ignores a second check while the first is still checking', () => {
    const { engine, updater } = harness()
    updater.check()
    engine.emit('checking-for-update')
    updater.check()
    expect(engine.checks).toBe(1)
  })

  it('accepts a new check once the engine said up to date or failed', () => {
    const { engine, updater } = harness()
    updater.check()
    engine.emit('update-not-available')
    updater.check()
    engine.emit('error', new Error('boom'))
    updater.check()
    expect(engine.checks).toBe(3)
  })

  it('ignores a check while an update is downloading or once it is downloaded', () => {
    const { engine, updater } = harness()
    updater.check()
    engine.emit('update-available', { version: '1.0.1' })
    updater.check()
    engine.emit('download-progress', { percent: 40 })
    updater.check()
    engine.emit('update-downloaded', { version: '1.0.1' })
    updater.check()
    expect(engine.checks).toBe(1)
  })

  it('relays every engine event as a status, percent rounded, the found version riding along with progress', () => {
    const { engine, statuses } = harness()
    engine.emit('checking-for-update')
    engine.emit('update-available', { version: '1.0.1' })
    engine.emit('download-progress', { percent: 41.6 })
    engine.emit('update-downloaded', { version: '1.0.1' })
    engine.emit('update-not-available')
    engine.emit('error', new Error('boom'))
    expect(statuses).toEqual([
      { status: 'checking' },
      { status: 'available', version: '1.0.1' },
      { status: 'downloading', version: '1.0.1', percent: 42 },
      { status: 'ready', version: '1.0.1' },
      { status: 'none' },
      { status: 'error' },
    ])
  })

  it('reports error when checkForUpdates rejects, and is free to check again', async () => {
    const { engine, statuses, updater } = harness({ reject: true })
    updater.check()
    await Promise.resolve()
    await Promise.resolve()
    expect(statuses).toEqual([{ status: 'error' }])
    updater.check()
    expect(engine.checks).toBe(2)
  })

  it('install hands over to the engine', () => {
    const { engine, updater } = harness()
    updater.install()
    expect(engine.installs).toBe(1)
  })
})
