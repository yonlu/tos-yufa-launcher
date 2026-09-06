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
