import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings'

describe('SettingsStore', () => {
  it('defaults download connections to 2 on first run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yufa-settings-'))
    expect(new SettingsStore(dir).get().downloadConcurrency).toBe(2)
  })

  it('falls back to 2 when the stored value is out of range', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yufa-settings-'))
    await writeFile(join(dir, 'config.json'), JSON.stringify({ downloadConcurrency: 8 }))
    expect(new SettingsStore(dir).get().downloadConcurrency).toBe(2)
  })

  it('keeps a stored value of 1 or 3', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yufa-settings-'))
    await writeFile(join(dir, 'config.json'), JSON.stringify({ downloadConcurrency: 3 }))
    const store = new SettingsStore(dir)
    expect(store.get().downloadConcurrency).toBe(3)
    expect(store.set({ downloadConcurrency: 1 }).downloadConcurrency).toBe(1)
  })
})
