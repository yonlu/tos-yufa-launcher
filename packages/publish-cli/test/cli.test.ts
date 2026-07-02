import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { GRANDFATHER_REVISION as GF, manifestSchema, patchFileName } from '@yufa/shared'
import { newsPush, patch, publishLauncher, rollback, seed, verify, type Ctx } from '../src/commands'
import type { PublishConfig } from '../src/config'
import { DryRunStore, LocalDirStore } from '../src/store'

const cfg: PublishConfig = {
  bucket: 'test',
  endpoint: 'https://example.invalid',
  publicBaseUrl: 'https://patch.test/',
  manifestKey: 'manifest.json',
  patchesPrefix: 'patches/',
  newsKey: 'news/news.json',
  newsImagesPrefix: 'news/img/',
  launcherPrefix: 'launcher/',
  grandfatherRevision: GF,
}

let staging: string
let out: string
let store: LocalDirStore
let logs: string[]
let ctx: Ctx

async function makeIpf(dir: string, revision: number, bytes = 2048) {
  const name = patchFileName(revision)
  const content = randomBytes(bytes)
  const path = join(dir, name)
  await writeFile(path, content)
  return { path, name, revision, size: bytes, sha256: createHash('sha256').update(content).digest('hex'), content }
}

async function readManifest() {
  return manifestSchema.parse(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')))
}

beforeEach(async () => {
  staging = await mkdtemp(join(tmpdir(), 'yufa-staging-'))
  out = await mkdtemp(join(tmpdir(), 'yufa-out-'))
  store = new LocalDirStore(out)
  logs = []
  ctx = { cfg, store, log: (m) => logs.push(m) }
})

describe('patch', () => {
  it('publishes files ascending with correct hashes, objects before manifest', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    const f2 = await makeIpf(staging, GF + 2, 4096)

    await patch(ctx, { files: [f2.path, f1.path] }) // reversed on purpose

    const m = await readManifest()
    expect(m.revision).toBe(GF + 2)
    expect(m.files.map((f) => f.name)).toEqual([f1.name, f2.name])
    expect(m.files[0]!.sha256).toBe(f1.sha256)
    expect(m.files[1]!.sha256).toBe(f2.sha256)
    expect(m.baseUrl).toBe('https://patch.test/patches/')

    const stored = await readFile(join(out, 'patches', f1.name))
    expect(stored.equals(f1.content)).toBe(true)

    const manifestIdx = store.ops.indexOf('manifest.json')
    for (const key of [`patches/${f1.name}`, `patches/${f2.name}`]) {
      expect(store.ops.indexOf(key)).toBeGreaterThanOrEqual(0)
      expect(store.ops.indexOf(key)).toBeLessThan(manifestIdx)
    }
  })

  it('appends incrementally to an existing manifest', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    await patch(ctx, { files: [f1.path] })
    const f2 = await makeIpf(staging, GF + 2)
    await patch(ctx, { files: [f2.path] })

    const m = await readManifest()
    expect(m.files).toHaveLength(2)
    expect(m.revision).toBe(GF + 2)
  })

  it('rejects a revision at or below the current manifest revision', async () => {
    const f2 = await makeIpf(staging, GF + 2)
    await patch(ctx, { files: [f2.path] })
    const f1 = await makeIpf(staging, GF + 1)
    await expect(patch(ctx, { files: [f1.path] })).rejects.toThrow(/must be greater/)
  })

  it('rejects files that are not patch archives', async () => {
    const bad = join(staging, 'not-a-patch.zip')
    await writeFile(bad, 'x')
    await expect(patch(ctx, { files: [bad] })).rejects.toThrow(/does not match/)
  })
})

describe('rollback', () => {
  it('truncates the manifest and lowers the revision', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    const f2 = await makeIpf(staging, GF + 2)
    await patch(ctx, { files: [f1.path, f2.path] })

    let m = await rollback(ctx, GF + 1)
    expect(m.files.map((f) => f.name)).toEqual([f1.name])
    expect(m.revision).toBe(GF + 1)

    m = await rollback(ctx, GF)
    expect(m.files).toEqual([])
    expect(m.revision).toBe(GF)
  })

  it('rounds a non-exact revision down to the nearest remaining patch', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    const f5 = await makeIpf(staging, GF + 5)
    await patch(ctx, { files: [f1.path, f5.path] })

    const m = await rollback(ctx, GF + 3)
    expect(m.revision).toBe(GF + 1)
    expect(logs.some((l) => l.includes('not an exact patch revision'))).toBe(true)
  })

  it('refuses to roll below the grandfather revision', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    await patch(ctx, { files: [f1.path] })
    await expect(rollback(ctx, GF - 1)).rejects.toThrow(/below the grandfather/)
  })
})

describe('seed', () => {
  async function makeGameDir(recordedRevision: number) {
    const game = await mkdtemp(join(tmpdir(), 'yufa-game-'))
    const patchDir = join(game, 'patch')
    await mkdir(patchDir, { recursive: true })
    await mkdir(join(game, 'release'), { recursive: true })
    await writeFile(join(game, 'release', 'release.revision.txt'), String(recordedRevision))
    await makeIpf(patchDir, 11072) // grandfathered base file — never a candidate
    return { game, patchDir }
  }

  it('demands an explicit decision for every candidate above the grandfather line', async () => {
    const { patchDir } = await makeGameDir(GF)
    await makeIpf(patchDir, GF + 1)
    await expect(seed(ctx, { patchDir, include: [], exclude: [] })).rejects.toThrow(/explicit decision/)
  })

  it('warns loudly about files above the recorded client revision', async () => {
    const { patchDir } = await makeGameDir(GF)
    const f = await makeIpf(patchDir, GF + 7)
    await seed(ctx, { patchDir, include: [f.name], exclude: [] })
    expect(logs.some((l) => l.includes('ABOVE the recorded client revision'))).toBe(true)
    const m = await readManifest()
    expect(m.revision).toBe(GF + 7)
    expect(m.files.map((x) => x.name)).toEqual([f.name])
  })

  it('excluded candidates stay out; base files are never candidates', async () => {
    const { patchDir } = await makeGameDir(GF)
    const f = await makeIpf(patchDir, GF + 1)
    await seed(ctx, { patchDir, include: [], exclude: [f.name] })
    const m = await readManifest()
    expect(m.files).toEqual([])
    expect(m.revision).toBe(GF)
  })

  it('rejects include/exclude names that are not candidates', async () => {
    const { patchDir } = await makeGameDir(GF)
    await expect(seed(ctx, { patchDir, include: ['nope_001001.ipf'], exclude: [] })).rejects.toThrow(/not found among/)
  })
})

describe('news', () => {
  it('validates and publishes a feed', async () => {
    const file = join(staging, 'news.json')
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        items: [{ id: 'a', date: '2026-07-01', title: { en: 't' }, body: { en: 'b' } }],
      }),
    )
    await newsPush(ctx, file)
    const stored = JSON.parse(await readFile(join(out, 'news', 'news.json'), 'utf8'))
    expect(stored.items).toHaveLength(1)
  })

  it('rejects an invalid feed', async () => {
    const file = join(staging, 'news.json')
    await writeFile(file, JSON.stringify({ schemaVersion: 1, items: [{ id: '', date: 'bad' }] }))
    await expect(newsPush(ctx, file)).rejects.toThrow()
  })
})

describe('verify', () => {
  it('passes on a consistent store and mirror', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    await patch(ctx, { files: [f1.path] })
    const result = await verify(ctx, { mirror: staging })
    expect(result).toEqual({ ok: true, problems: [] })
  })

  it('flags size drift in the store', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    await patch(ctx, { files: [f1.path] })
    await truncate(join(out, 'patches', f1.name), 10)
    const result = await verify(ctx)
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toMatch(/stored size 10/)
  })
})

describe('dry-run', () => {
  it('writes nothing and logs intents', async () => {
    const dryCtx: Ctx = { cfg, store: new DryRunStore(store, (m) => logs.push(m)), log: (m) => logs.push(m) }
    const f1 = await makeIpf(staging, GF + 1)
    await patch(dryCtx, { files: [f1.path] })
    expect(await store.getText('manifest.json')).toBeNull()
    expect(logs.some((l) => l.includes('[dry-run]'))).toBe(true)
  })
})

describe('launcher publish', () => {
  it('uploads installers first and latest.yml last, and can gate minLauncherVersion', async () => {
    const f1 = await makeIpf(staging, GF + 1)
    await patch(ctx, { files: [f1.path] })

    const dist = await mkdtemp(join(tmpdir(), 'yufa-dist-'))
    await writeFile(join(dist, 'Yufa-Launcher-Setup-1.0.1.exe'), randomBytes(128))
    await writeFile(join(dist, 'Yufa-Launcher-Setup-1.0.1.exe.blockmap'), randomBytes(32))
    await writeFile(join(dist, 'latest.yml'), 'version: 1.0.1\n')

    await publishLauncher(ctx, dist, '1.0.1')

    const ymlIdx = store.ops.indexOf('launcher/latest.yml')
    const exeIdx = store.ops.indexOf('launcher/Yufa-Launcher-Setup-1.0.1.exe')
    expect(exeIdx).toBeGreaterThanOrEqual(0)
    expect(exeIdx).toBeLessThan(ymlIdx)

    const m = await readManifest()
    expect(m.minLauncherVersion).toBe('1.0.1')
  })

  it('refuses a dist dir without latest.yml', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'yufa-dist-'))
    await expect(publishLauncher(ctx, dist)).rejects.toThrow(/latest\.yml not found/)
  })
})
