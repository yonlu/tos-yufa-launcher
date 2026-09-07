import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { bootSettings, type BootApp } from '../src/main/boot'
import { SettingsStore } from '../src/main/settings'

let userData: string
/** What YUFA_USERDATA points at. */
let hookUserData: string

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'yufa-boot-default-'))
  hookUserData = await mkdtemp(join(tmpdir(), 'yufa-boot-hook-'))
})

/** An `app` that logs what was asked of it, in order. */
function fakeApp(): BootApp & { log: string[] } {
  let userDataPath = userData
  const fake = {
    log: [] as string[],
    setPath(name: 'userData', path: string) {
      fake.log.push(`setPath ${name}`)
      userDataPath = path
    },
    getPath(name: 'userData') {
      fake.log.push(`getPath ${name}`)
      return userDataPath
    },
    disableHardwareAcceleration() {
      fake.log.push('disableHardwareAcceleration')
    },
  }
  return fake
}

describe('bootSettings (before app.whenReady)', () => {
  it('opens the store at userData and leaves hardware acceleration alone by default', () => {
    const app = fakeApp()
    const boot = bootSettings(app, {})
    expect(boot.settings.get().hardwareAcceleration).toBe(true)
    expect(boot.hardwareAcceleration).toBe(true)
    expect(app.log).toEqual(['getPath userData'])
  })

  it('reads the store first, then switches hardware acceleration off when the saved value is false', async () => {
    await writeFile(join(userData, 'config.json'), JSON.stringify({ hardwareAcceleration: false }))
    const app = fakeApp()
    const boot = bootSettings(app, {})
    expect(boot.hardwareAcceleration).toBe(false)
    expect(app.log).toEqual(['getPath userData', 'disableHardwareAcceleration'])
  })

  it('YUFA_USERDATA moves userData before the store is opened, so the switch is read from there', async () => {
    await writeFile(join(hookUserData, 'config.json'), JSON.stringify({ hardwareAcceleration: false }))
    const app = fakeApp()
    const boot = bootSettings(app, { YUFA_USERDATA: hookUserData })
    expect(app.log).toEqual(['setPath userData', 'getPath userData', 'disableHardwareAcceleration'])
    expect(boot.hardwareAcceleration).toBe(false)
    // the default folder was never consulted
    expect(new SettingsStore(userData).get().hardwareAcceleration).toBe(true)
  })

  it('restartRequired follows the difference between the saved value and the boot-time one', () => {
    const app = fakeApp()
    const boot = bootSettings(app, {})
    expect(boot.restartRequired()).toBe(false)
    boot.settings.set({ hardwareAcceleration: false })
    expect(boot.restartRequired()).toBe(true)
    boot.settings.set({ hardwareAcceleration: true })
    expect(boot.restartRequired()).toBe(false)
    // the process keeps running with the boot-time value; saving does not re-apply it
    expect(app.log).toEqual(['getPath userData'])
  })

  it('restartRequired ignores other settings', () => {
    const boot = bootSettings(fakeApp(), {})
    boot.settings.set({ language: 'en', downloadConcurrency: 3 })
    expect(boot.restartRequired()).toBe(false)
  })
})
