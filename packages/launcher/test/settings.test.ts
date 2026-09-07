import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings'

let userData: string

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'yufa-settings-'))
})

describe('SettingsStore', () => {
  it('defaults downloadConcurrency to 2 on first run', () => {
    expect(new SettingsStore(userData).get().downloadConcurrency).toBe(2)
  })

  it('falls back to 2 when the stored value is out of range', async () => {
    await writeFile(join(userData, 'config.json'), JSON.stringify({ downloadConcurrency: 8 }))
    expect(new SettingsStore(userData).get().downloadConcurrency).toBe(2)
  })

  it('keeps a stored value of 1 or 3', async () => {
    await writeFile(join(userData, 'config.json'), JSON.stringify({ downloadConcurrency: 3 }))
    const store = new SettingsStore(userData)
    expect(store.get().downloadConcurrency).toBe(3)
    expect(store.set({ downloadConcurrency: 1 }).downloadConcurrency).toBe(1)
  })
})

describe('SettingsStore: Compatibility fix fields (ADR 0003)', () => {
  it('both default to false on first run', () => {
    const s = new SettingsStore(userData).get()
    expect(s.amdCompatibilityEnabled).toBe(false)
    expect(s.amdCompatibilityPrompted).toBe(false)
  })

  it('a config.json written before the fields existed reads as defaults', async () => {
    await writeFile(join(userData, 'config.json'), JSON.stringify({ gamePath: 'C:\\tos', language: 'en' }))
    const s = new SettingsStore(userData).get()
    expect(s.amdCompatibilityEnabled).toBe(false)
    expect(s.amdCompatibilityPrompted).toBe(false)
  })

  it('only a real true counts; corrupt values fall back to false', async () => {
    await writeFile(
      join(userData, 'config.json'),
      JSON.stringify({ amdCompatibilityEnabled: 'true', amdCompatibilityPrompted: 1 }),
    )
    const s = new SettingsStore(userData).get()
    expect(s.amdCompatibilityEnabled).toBe(false)
    expect(s.amdCompatibilityPrompted).toBe(false)
  })

  it('round-trips true through set and a fresh load', async () => {
    const store = new SettingsStore(userData)
    expect(store.set({ amdCompatibilityEnabled: true, amdCompatibilityPrompted: true })).toMatchObject({
      amdCompatibilityEnabled: true,
      amdCompatibilityPrompted: true,
    })
    const again = new SettingsStore(userData).get()
    expect(again.amdCompatibilityEnabled).toBe(true)
    expect(again.amdCompatibilityPrompted).toBe(true)
  })

  it('set rejects a corrupt value without touching the other field', () => {
    const store = new SettingsStore(userData)
    store.set({ amdCompatibilityPrompted: true })
    const s = store.set({ amdCompatibilityEnabled: 'yes' as never })
    expect(s.amdCompatibilityEnabled).toBe(false)
    expect(s.amdCompatibilityPrompted).toBe(true)
  })
})
