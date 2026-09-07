import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DXVK_FILE } from '@yufa/shared'
import { Dxvk, type DxvkDeps } from '../src/main/dxvk'

/** Three distinct fake DLLs: what the launcher bundles now, what an older launcher bundled, and someone else's. */
const CURRENT = randomBytes(4096)
const PREVIOUS = randomBytes(4096)
const FOREIGN = randomBytes(4096)
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

let gameDir: string
let releaseDir: string
let bundledDll: string

beforeEach(async () => {
  gameDir = join(await mkdtemp(join(tmpdir(), 'yufa-dxvk-game-')), 'ToS Classic')
  releaseDir = join(gameDir, 'release')
  await mkdir(releaseDir, { recursive: true })
  await writeFile(join(releaseDir, 'Yuka.exe'), 'client')
  const bundledDir = await mkdtemp(join(tmpdir(), 'yufa-dxvk-bundle-'))
  bundledDll = join(bundledDir, DXVK_FILE)
  await writeFile(bundledDll, CURRENT)
})

interface Harness {
  dxvk: Dxvk
  flag: () => boolean
  setFlag: (on: boolean) => void
  setRunning: (on: boolean) => void
  setBusy: (on: boolean) => void
}

/** The module wired the way index.ts wires it, with the switch, the game and the patcher as knobs. */
function harness(over: Partial<DxvkDeps> = {}): Harness {
  let flag = false
  let running = false
  let busy = false
  const dxvk = new Dxvk({
    gameDir: () => gameDir,
    bundledDll,
    flag: {
      get: () => flag,
      set: (on) => {
        flag = on
      },
    },
    isGameRunning: async () => running,
    isPatcherBusy: () => busy,
    pins: { current: sha256(CURRENT), previous: [sha256(PREVIOUS)] },
    ...over,
  })
  return {
    dxvk,
    flag: () => flag,
    setFlag: (on) => {
      flag = on
    },
    setRunning: (on) => {
      running = on
    },
    setBusy: (on) => {
      busy = on
    },
  }
}

const target = () => join(releaseDir, DXVK_FILE)
const placed = (content: Buffer) => writeFile(target(), content)
const contentIs = async (content: Buffer) => (await readFile(target())).equals(content)
/** Everything in release/: the fix must add exactly one file and leave no temp name behind. */
const releaseListing = async () =>
  (await readdir(releaseDir)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))

describe('enable()', () => {
  it('from clean: places the bundled file, sets the switch, leaves nothing else in release/', async () => {
    const h = harness()
    const result = await h.dxvk.enable()
    expect(result).toEqual({ outcome: 'installed', enabled: true })
    expect(h.flag()).toBe(true)
    expect(await contentIs(CURRENT)).toBe(true)
    expect(await releaseListing()).toEqual([DXVK_FILE, 'Yuka.exe'])
    expect(await readdir(gameDir)).toEqual(['release'])
  })

  it('over the current pin: nothing is rewritten, the switch is set', async () => {
    await placed(CURRENT)
    const before = await stat(target())
    await new Promise((r) => setTimeout(r, 20))
    const h = harness()
    expect(await h.dxvk.enable()).toEqual({ outcome: 'present', enabled: true })
    expect(h.flag()).toBe(true)
    expect((await stat(target())).mtimeMs).toBe(before.mtimeMs)
    expect(await releaseListing()).toEqual([DXVK_FILE, 'Yuka.exe'])
  })

  it('over a previous pin: the file an older launcher installed is replaced by the current one', async () => {
    await placed(PREVIOUS)
    const h = harness()
    expect(await h.dxvk.enable()).toEqual({ outcome: 'upgraded', enabled: true })
    expect(await contentIs(CURRENT)).toBe(true)
    expect(await releaseListing()).toEqual([DXVK_FILE, 'Yuka.exe'])
  })

  it('over a foreign file: refused with foreign-dll naming the path, nothing written, switch stays off', async () => {
    await placed(FOREIGN)
    const h = harness()
    const result = await h.dxvk.enable()
    expect(result).toEqual({ outcome: 'foreign', enabled: false, error: { code: 'foreign-dll', message: target() } })
    expect(h.flag()).toBe(false)
    expect(await contentIs(FOREIGN)).toBe(true)
    expect(await releaseListing()).toEqual([DXVK_FILE, 'Yuka.exe'])
  })

  it('a bundled file that does not match the pin is never installed', async () => {
    await writeFile(bundledDll, FOREIGN)
    const h = harness()
    const result = await h.dxvk.enable()
    expect(result.outcome).toBe('failed')
    expect(result.enabled).toBe(false)
    expect(result.error?.code).toBe('dxvk-failed')
    expect(h.flag()).toBe(false)
    expect(await releaseListing()).toEqual(['Yuka.exe'])
  })

  it('without a release/ folder: fails and creates nothing in the game folder', async () => {
    gameDir = join(gameDir, 'elsewhere')
    const h = harness()
    const result = await h.dxvk.enable()
    expect(result.outcome).toBe('failed')
    expect(result.error?.code).toBe('dxvk-failed')
    expect(existsSync(gameDir)).toBe(false)
  })
})

describe('disable()', () => {
  it('removes the current-pin file and clears the switch', async () => {
    await placed(CURRENT)
    const h = harness()
    h.setFlag(true)
    expect(await h.dxvk.disable()).toEqual({ outcome: 'removed', enabled: false })
    expect(h.flag()).toBe(false)
    expect(await releaseListing()).toEqual(['Yuka.exe'])
  })

  it('removes a previous-pin file too', async () => {
    await placed(PREVIOUS)
    const h = harness()
    h.setFlag(true)
    expect(await h.dxvk.disable()).toEqual({ outcome: 'removed', enabled: false })
    expect(await releaseListing()).toEqual(['Yuka.exe'])
  })

  it('leaves a foreign file where it is, warns, and still clears the switch', async () => {
    await placed(FOREIGN)
    const h = harness()
    h.setFlag(true)
    const result = await h.dxvk.disable()
    expect(result).toEqual({ outcome: 'foreign', enabled: false, error: { code: 'foreign-dll', message: target() } })
    expect(h.flag()).toBe(false)
    expect(await contentIs(FOREIGN)).toBe(true)
  })

  it('with no file: nothing to do, switch cleared', async () => {
    const h = harness()
    h.setFlag(true)
    expect(await h.dxvk.disable()).toEqual({ outcome: 'absent', enabled: false })
    expect(h.flag()).toBe(false)
    expect(await releaseListing()).toEqual(['Yuka.exe'])
  })
})

describe('reconcile()', () => {
  it('switch off: does nothing and reports nothing', async () => {
    await placed(FOREIGN)
    const h = harness()
    expect(await h.dxvk.reconcile()).toBeUndefined()
    expect(await contentIs(FOREIGN)).toBe(true)
  })

  it('switch on, file gone (quarantined): puts it back', async () => {
    const h = harness()
    h.setFlag(true)
    expect(await h.dxvk.reconcile()).toEqual({ outcome: 'installed', enabled: true })
    expect(await contentIs(CURRENT)).toBe(true)
  })

  it('switch on, previous pin on disk: upgrades it', async () => {
    await placed(PREVIOUS)
    const h = harness()
    h.setFlag(true)
    expect(await h.dxvk.reconcile()).toEqual({ outcome: 'upgraded', enabled: true })
    expect(await contentIs(CURRENT)).toBe(true)
  })

  it('switch on, foreign file on disk: the refusal is reported and the switch is left alone', async () => {
    await placed(FOREIGN)
    const h = harness()
    h.setFlag(true)
    const result = await h.dxvk.reconcile()
    expect(result?.outcome).toBe('foreign')
    expect(result?.error?.code).toBe('foreign-dll')
    expect(h.flag()).toBe(true)
    expect(await contentIs(FOREIGN)).toBe(true)
  })

  it('runs while the patcher is busy: it is the patcher that calls it', async () => {
    const h = harness()
    h.setFlag(true)
    h.setBusy(true)
    expect(await h.dxvk.reconcile()).toEqual({ outcome: 'installed', enabled: true })
  })
})

describe('refusals', () => {
  it('every operation is refused while the game runs; nothing is written and the switch does not move', async () => {
    const h = harness()
    h.setRunning(true)
    expect(await h.dxvk.enable()).toEqual({ outcome: 'failed', enabled: false, error: { code: 'game-running' } })
    expect(await releaseListing()).toEqual(['Yuka.exe'])

    await placed(CURRENT)
    h.setFlag(true)
    expect(await h.dxvk.disable()).toEqual({ outcome: 'failed', enabled: true, error: { code: 'game-running' } })
    expect(await contentIs(CURRENT)).toBe(true)
    expect(h.flag()).toBe(true)

    await placed(PREVIOUS)
    expect(await h.dxvk.reconcile()).toEqual({ outcome: 'failed', enabled: true, error: { code: 'game-running' } })
    expect(await contentIs(PREVIOUS)).toBe(true)
  })

  it('enable and disable are refused while the patcher is mid-run', async () => {
    const h = harness()
    h.setBusy(true)
    expect(await h.dxvk.enable()).toEqual({ outcome: 'failed', enabled: false, error: { code: 'busy' } })
    expect(await releaseListing()).toEqual(['Yuka.exe'])
    await placed(CURRENT)
    h.setFlag(true)
    expect(await h.dxvk.disable()).toEqual({ outcome: 'failed', enabled: true, error: { code: 'busy' } })
    expect(await contentIs(CURRENT)).toBe(true)
  })

  it('operations never overlap: a burst of enable/disable calls ends in a consistent state', async () => {
    const h = harness()
    const results = await Promise.all([h.dxvk.enable(), h.dxvk.disable(), h.dxvk.enable()])
    expect(results.map((r) => r.outcome)).toEqual(['installed', 'removed', 'installed'])
    expect(h.flag()).toBe(true)
    expect(await contentIs(CURRENT)).toBe(true)
    expect(await releaseListing()).toEqual([DXVK_FILE, 'Yuka.exe'])
  })
})
