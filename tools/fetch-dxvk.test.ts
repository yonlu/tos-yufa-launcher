import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as tar from 'tar'
import { beforeEach, describe, expect, it } from 'vitest'
import { DXVK_FILE, DXVK_LICENSE_FILE, DXVK_VERSION } from '../packages/shared/src/index'
import { DxvkPinMismatch, fetchDxvk, stageDxvk } from './fetch-dxvk'

let base: string
const quiet = { log: () => {} }

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** A release archive shaped like the official one: `dxvk-<v>/x32/d3d9.dll` and its siblings, no licence inside. */
async function fixtureTarball(name: string, files: Record<string, Buffer | string>): Promise<string> {
  const src = join(base, `${name}-src`)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(src, `dxvk-${DXVK_VERSION}`, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
  const file = join(base, `${name}.tar.gz`)
  await tar.c({ gzip: true, file, cwd: src }, [`dxvk-${DXVK_VERSION}`])
  return file
}

/** The licence text the repository serves at the release tag, saved where the script would cache it. */
async function fixtureLicense(text = 'zlib licence text'): Promise<string> {
  const file = join(base, 'LICENSE')
  await writeFile(file, text)
  return file
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'yufa-dxvk-'))
})

describe('stageDxvk (release archive → build/dxvk)', () => {
  it('stages d3d9.dll and LICENSE when the DLL matches the pin', async () => {
    const dll = randomBytes(4096)
    const tarball = await fixtureTarball('good', { 'x32/d3d9.dll': dll, 'x64/d3d9.dll': randomBytes(64) })
    const stageDir = join(base, 'stage')

    const result = await stageDxvk({ tarball, licenseFile: await fixtureLicense(), stageDir, pin: sha256(dll) })

    expect(result.sha256).toBe(sha256(dll))
    expect(await readFile(join(stageDir, DXVK_FILE))).toEqual(dll)
    expect(await readFile(join(stageDir, DXVK_LICENSE_FILE), 'utf8')).toBe('zlib licence text')
    expect((await readdir(stageDir)).sort()).toEqual([DXVK_LICENSE_FILE, DXVK_FILE].sort())
  })

  it('refuses a tarball whose d3d9.dll does not match the pin and stages nothing', async () => {
    const dll = randomBytes(4096)
    const tarball = await fixtureTarball('bad', { 'x32/d3d9.dll': dll })
    const stageDir = join(base, 'stage')
    const pin = sha256(Buffer.from('something else'))

    const err = await stageDxvk({ tarball, licenseFile: await fixtureLicense(), stageDir, pin }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DxvkPinMismatch)
    expect((err as DxvkPinMismatch).expected).toBe(pin)
    expect((err as DxvkPinMismatch).actual).toBe(sha256(dll))
    expect((err as Error).message).toContain(sha256(dll))
    expect(existsSync(stageDir)).toBe(false)
  })

  it('a mismatch also clears a previously staged file, so a build cannot ship a stale DLL', async () => {
    const tarball = await fixtureTarball('bad', { 'x32/d3d9.dll': randomBytes(64) })
    const licenseFile = await fixtureLicense()
    const stageDir = join(base, 'stage')
    await mkdir(stageDir, { recursive: true })
    await writeFile(join(stageDir, DXVK_FILE), 'stale')
    await writeFile(join(stageDir, DXVK_LICENSE_FILE), 'stale')

    await expect(stageDxvk({ tarball, licenseFile, stageDir, pin: sha256(Buffer.from('x')) })).rejects.toBeInstanceOf(DxvkPinMismatch)

    expect(existsSync(join(stageDir, DXVK_FILE))).toBe(false)
    expect(existsSync(join(stageDir, DXVK_LICENSE_FILE))).toBe(false)
  })

  it('refuses an archive without the x86 DLL, or a missing licence file, and stages nothing', async () => {
    const dll = randomBytes(64)
    const good = await fixtureTarball('good', { 'x32/d3d9.dll': dll })
    const noDll = await fixtureTarball('no-dll', { 'x64/d3d9.dll': dll })
    const licenseFile = await fixtureLicense()
    const stageDir = join(base, 'stage')

    await expect(stageDxvk({ tarball: noDll, licenseFile, stageDir, pin: sha256(dll) })).rejects.toThrow(/x32\/d3d9\.dll/)
    await expect(stageDxvk({ tarball: good, licenseFile: join(base, 'missing'), stageDir, pin: sha256(dll) })).rejects.toThrow(/LICENSE/)
    expect(existsSync(stageDir)).toBe(false)
  })
})

describe('fetchDxvk (download once per machine, then stage)', () => {
  const url = 'https://example.invalid/dxvk-2.5.tar.gz'
  const licenseUrl = 'https://example.invalid/v2.5/LICENSE'

  /** Serves the archive at `url` and the licence text at `licenseUrl`; anything else is a 404. */
  function fakeFetch(archive: Buffer, license = 'zlib licence text'): { fetchImpl: typeof fetch; calls: string[] } {
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
      const target = String(input)
      calls.push(target)
      if (target === url) return new Response(new Uint8Array(archive), { status: 200 })
      if (target === licenseUrl) return new Response(license, { status: 200 })
      return new Response('nope', { status: 404 })
    }) as typeof fetch
    return { fetchImpl, calls }
  }

  it('downloads the archive and the licence into the cache, stages both, and reuses the cache on the next run', async () => {
    const dll = randomBytes(1024)
    const tarball = await fixtureTarball('good', { 'x32/d3d9.dll': dll })
    const { fetchImpl, calls } = fakeFetch(await readFile(tarball))
    const cacheDir = join(base, 'cache')
    const stageDir = join(base, 'stage')

    const first = await fetchDxvk({ url, licenseUrl, cacheDir, stageDir, pin: sha256(dll), fetchImpl, ...quiet })
    expect(first.downloaded).toBe(true)
    expect(calls.sort()).toEqual([licenseUrl, url].sort())
    expect(await readFile(join(stageDir, DXVK_FILE))).toEqual(dll)
    expect(await readFile(join(stageDir, DXVK_LICENSE_FILE), 'utf8')).toBe('zlib licence text')
    expect(existsSync(first.tarball)).toBe(true)
    expect(dirname(first.tarball)).toBe(cacheDir)

    const second = await fetchDxvk({ url, licenseUrl, cacheDir, stageDir, pin: sha256(dll), fetchImpl, ...quiet })
    expect(second.downloaded).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it('a cached archive that fails the pin is refused without touching the stage', async () => {
    const tarball = await fixtureTarball('bad', { 'x32/d3d9.dll': randomBytes(1024) })
    const { fetchImpl } = fakeFetch(await readFile(tarball))
    const stageDir = join(base, 'stage')

    await expect(
      fetchDxvk({ url, licenseUrl, cacheDir: join(base, 'cache'), stageDir, pin: 'a'.repeat(64), fetchImpl, ...quiet }),
    ).rejects.toBeInstanceOf(DxvkPinMismatch)
    expect(existsSync(stageDir)).toBe(false)
  })

  it('a failed download leaves nothing in the cache', async () => {
    const { fetchImpl } = fakeFetch(Buffer.alloc(0))
    const cacheDir = join(base, 'cache')

    await expect(
      fetchDxvk({ url: 'https://example.invalid/other.tar.gz', licenseUrl, cacheDir, stageDir: join(base, 'stage'), pin: 'a'.repeat(64), fetchImpl, ...quiet }),
    ).rejects.toThrow(/404/)
    expect(existsSync(cacheDir) ? await readdir(cacheDir) : []).toEqual([])
  })
})
