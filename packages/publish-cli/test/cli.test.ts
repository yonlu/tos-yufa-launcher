import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, truncate, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { manifestSchema, patchFileName, redistIndexSchema, type Manifest } from '@yufa/shared'
import { gc, newsPush, patch, publishLauncher, redistPush, release, rollback, verify, type Ctx } from '../src/commands'
import { DEFAULT_EXCLUDES, DEFAULT_SEED_ONCE, type PublishConfig } from '../src/config'
import { sha256File } from '../src/hash'
import { DryRunStore, LocalDirStore } from '../src/store'

let staging: string
let out: string
let store: LocalDirStore
let logs: string[]
let ctx: Ctx
let cfg: PublishConfig

function sha(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Writes `rel` (forward slashes) under `root`, creating directories. */
async function put(root: string, rel: string, content: Buffer | string = randomBytes(256)) {
  const path = join(root, ...rel.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  return { path, content: Buffer.isBuffer(content) ? content : Buffer.from(content) }
}

/**
 * A miniature game folder: managed data, one patch archive, the client exe,
 * a seed-once layout file, and every kind of junk the publisher must skip.
 */
async function makeGameTree() {
  const game = await mkdtemp(join(tmpdir(), 'yufa-game-'))
  const bg = await put(game, 'data/bg.ipf')
  const arch = await put(game, `patch/${patchFileName(1116001)}`)
  const exe = await put(game, 'release/Yuka.exe')
  const layout = await put(game, 'release/uilayout.xml', '<layout/>')
  // hard-guarded
  await put(game, 'release/user.xml', '<user login="operator"/>')
  await put(game, 'release/user_c.xml')
  await put(game, 'release/hud_config.xml')
  await put(game, 'release/serverlist_recent.xml')
  await put(game, 'release/CheatLogData', 'binary session log')
  await put(game, 'release/chat_config_1.xml')
  await put(game, 'release/release.revision.txt', '1116001')
  await put(game, 'release/screenshot/shot.png')
  await put(game, 'release/log_Client/x.log')
  await put(game, 'user/whatever.dat')
  await put(game, 'patch/1116002_001001.ipf.part')
  await put(game, 'addons/_betterquest.ipf')
  // excluded by default config
  await put(game, 'release/patch/junk.ipf')
  await put(game, '_CommonRedist/vc_redist.x86.exe')
  return { game, bg, arch, exe, layout }
}

async function makeIpf(dir: string, revision: number, bytes = 2048) {
  const name = patchFileName(revision)
  const content = randomBytes(bytes)
  const path = join(dir, name)
  await writeFile(path, content)
  return { path, name, revision, size: bytes, sha256: sha(content), content }
}

async function readCurrent(): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')))
}

async function readStored(build: number): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(join(out, 'manifests', `${build}.json`), 'utf8')))
}

function blobKeys(): string[] {
  return store.ops.filter((k) => k.startsWith('objects/'))
}

beforeEach(async () => {
  staging = await mkdtemp(join(tmpdir(), 'yufa-staging-'))
  out = await mkdtemp(join(tmpdir(), 'yufa-out-'))
  store = new LocalDirStore(out)
  logs = []
  cfg = {
    bucket: 'test',
    endpoint: 'https://example.invalid',
    publicBaseUrl: 'https://patch.test/',
    manifestKey: 'manifest.json',
    manifestsPrefix: 'manifests/',
    objectsPrefix: 'objects/',
    redistPrefix: 'redist/',
    newsKey: 'news/news.json',
    newsImagesPrefix: 'news/img/',
    launcherPrefix: 'launcher/',
    excludes: [...DEFAULT_EXCLUDES],
    seedOnce: [...DEFAULT_SEED_ONCE],
    hashCache: join(staging, 'hash-cache.json'),
  }
  ctx = { cfg, store, log: (m) => logs.push(m) }
})

describe('release', () => {
  it('publishes the folder as Blobs → stored Manifest → Current Manifest', async () => {
    const t = await makeGameTree()

    await release(ctx, { dir: t.game })

    const m = await readCurrent()
    expect(m.build).toBe(1)
    expect(m.revision).toBe(1116001)
    expect(m.blobBaseUrl).toBe('https://patch.test/objects/')
    expect(m.newsUrl).toBe('https://patch.test/news/news.json')
    expect(m.files).toEqual([
      { path: 'data/bg.ipf', size: 256, sha256: sha(t.bg.content), class: 'managed' },
      { path: `patch/${patchFileName(1116001)}`, size: 256, sha256: sha(t.arch.content), class: 'managed' },
      { path: 'release/Yuka.exe', size: 256, sha256: sha(t.exe.content), class: 'managed' },
      { path: 'release/uilayout.xml', size: 9, sha256: sha(t.layout.content), class: 'seed-once' },
    ])
    expect(await readStored(1)).toEqual(m)

    const stored = await readFile(join(out, 'objects', sha(t.bg.content)))
    expect(stored.equals(t.bg.content)).toBe(true)

    const storedIdx = store.ops.indexOf('manifests/1.json')
    const currentIdx = store.ops.indexOf('manifest.json')
    expect(blobKeys()).toHaveLength(4)
    for (const key of blobKeys()) expect(store.ops.indexOf(key)).toBeLessThan(storedIdx)
    expect(storedIdx).toBeLessThan(currentIdx)
    expect(currentIdx).toBe(store.ops.length - 1)
  })

  it('never publishes hard-guarded files, even when config drops the guard and the excludes', async () => {
    const t = await makeGameTree()
    const runtimeDirs = 'DisconnectLog GuildBanner GuildEmblem GuildIntroImage UploadEmblem analyze avicapture dump log_Client replay screenshot spraysave tempfiles user fade'.split(' ')
    for (const d of runtimeDirs) {
      await put(t.game, `release/${d}/leak.bin`)
      await put(t.game, `${d}/leak.bin`)
    }
    await put(t.game, 'release/chat_config_1234567.xml')
    await put(t.game, 'data/leftover.ipf.part')
    await put(t.game, '.yufa-install.json', '{}')
    const loose: PublishConfig = { ...cfg, excludes: [] }

    await release({ ...ctx, cfg: loose }, { dir: t.game })

    const paths = (await readCurrent()).files.map((f) => f.path)
    expect(paths).not.toContain('release/user.xml')
    expect(paths).not.toContain('release/CheatLogData')
    for (const p of paths) {
      expect(p, p).not.toMatch(/^release\/(user|user_c|hud_config|serverlist_recent|chat_config_\d+)\.xml$/)
      expect(p, p).not.toMatch(/release\.revision\.txt$|\.part$|^addons\/|^\.yufa-/)
      expect(p, p).not.toMatch(/leak\.bin$/)
    }
    // with excludes emptied, the default-excluded paths do get published
    expect(paths).toContain('release/patch/junk.ipf')
    expect(paths).toContain('_CommonRedist/vc_redist.x86.exe')
  })

  it('honours configured excludes and seed-once paths', async () => {
    const t = await makeGameTree()
    await put(t.game, 'data/keep.ipf')
    await put(t.game, 'release/hotkey_user.xml')
    const custom: PublishConfig = {
      ...cfg,
      excludes: [...DEFAULT_EXCLUDES, 'data/bg.ipf', 'release/*.exe'],
      seedOnce: ['release/hotkey_user.xml'],
    }

    await release({ ...ctx, cfg: custom }, { dir: t.game })

    const m = await readCurrent()
    expect(m.files.map((f) => [f.path, f.class])).toEqual([
      ['data/keep.ipf', 'managed'],
      [`patch/${patchFileName(1116001)}`, 'managed'],
      ['release/hotkey_user.xml', 'seed-once'],
      ['release/uilayout.xml', 'managed'],
    ])
  })

  it('numbers builds monotonically and records label and min launcher', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game, label: '1.0', minLauncher: '1.2.0' })
    await release(ctx, { dir: t.game })

    const m = await readCurrent()
    expect(m.build).toBe(2)
    expect(m.label).toBeUndefined()
    expect(m.minLauncherVersion).toBe('1.2.0')
    const first = await readStored(1)
    expect(first.build).toBe(1)
    expect(first.label).toBe('1.0')
    expect(first.minLauncherVersion).toBe('1.2.0')
    expect(first.files).toEqual(m.files)
  })

  it('uploads only Blobs the store lacks', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    expect(blobKeys()).toHaveLength(4)

    store.ops.length = 0
    await release(ctx, { dir: t.game })
    expect(blobKeys()).toEqual([])
    expect(store.ops).toEqual(['manifests/2.json', 'manifest.json'])

    store.ops.length = 0
    const changed = await put(t.game, 'release/Yuka.exe', randomBytes(300))
    await release(ctx, { dir: t.game })
    expect(blobKeys()).toEqual([`objects/${sha(changed.content)}`])
  })

  it('uploads one Blob for two identical files', async () => {
    const t = await makeGameTree()
    const same = randomBytes(64)
    await put(t.game, 'data/a.ipf', same)
    await put(t.game, 'data/b.ipf', same)

    await release(ctx, { dir: t.game })

    expect(blobKeys().filter((k) => k === `objects/${sha(same)}`)).toHaveLength(1)
    expect((await readCurrent()).files.filter((f) => f.sha256 === sha(same))).toHaveLength(2)
  })

  it('reuses the hash cache: untouched files are not re-hashed', async () => {
    const t = await makeGameTree()
    let hashed = 0
    const counting: Ctx = {
      ...ctx,
      hashFile: (p) => {
        hashed++
        return sha256File(p)
      },
    }

    await release(counting, { dir: t.game })
    expect(hashed).toBe(4)

    hashed = 0
    await release(counting, { dir: t.game })
    expect(hashed).toBe(0)

    // size change → re-hash exactly that file
    await put(t.game, 'data/bg.ipf', randomBytes(300))
    await release(counting, { dir: t.game })
    expect(hashed).toBe(1)
  })

  it('leaves every Blob listable by prefix with its size', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })

    const blobs = await store.list('objects/')

    expect(blobs.map((b) => b.key).sort()).toEqual(
      [t.bg, t.arch, t.exe, t.layout].map((f) => `objects/${sha(f.content)}`).sort(),
    )
    expect(blobs.find((b) => b.key === `objects/${sha(t.layout.content)}`)?.size).toBe(9)
    expect(await store.list('manifests/')).toEqual([{ key: 'manifests/1.json', size: expect.any(Number) }])
  })

  it('refuses a folder that does not look like a game folder', async () => {
    await expect(release(ctx, { dir: join(staging, 'missing') })).rejects.toThrow(/not a directory/)
  })
})

describe('patch', () => {
  it('starts a Build from nothing, appending archives ascending, Blobs before Manifests', async () => {
    const f1 = await makeIpf(staging, 1116001)
    const f2 = await makeIpf(staging, 1116002, 4096)

    await patch(ctx, { files: [f2.path, f1.path] }) // reversed on purpose

    const m = await readCurrent()
    expect(m.build).toBe(1)
    expect(m.revision).toBe(1116002)
    expect(m.files).toEqual([
      { path: `patch/${f1.name}`, size: f1.size, sha256: f1.sha256, class: 'managed' },
      { path: `patch/${f2.name}`, size: f2.size, sha256: f2.sha256, class: 'managed' },
    ])
    const stored = await readFile(join(out, 'objects', f1.sha256))
    expect(stored.equals(f1.content)).toBe(true)
    expect(store.ops).toEqual([`objects/${f1.sha256}`, `objects/${f2.sha256}`, 'manifests/1.json', 'manifest.json'])
  })

  it('adds archives on top of the current Build, keeping every other file', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    const f2 = await makeIpf(staging, 1116002)

    await patch(ctx, { files: [f2.path] })

    const m = await readCurrent()
    expect(m.build).toBe(2)
    expect(m.revision).toBe(1116002)
    expect(m.files.map((f) => f.path)).toEqual([
      'data/bg.ipf',
      `patch/${patchFileName(1116001)}`,
      `patch/${f2.name}`,
      'release/Yuka.exe',
      'release/uilayout.xml',
    ])
    expect((await readStored(1)).files).toHaveLength(4)
  })

  it('refuses to publish a Build whose carried-forward Blob is missing from the store', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    await rm(join(out, 'objects', sha(t.exe.content)))
    const f2 = await makeIpf(staging, 1116002)

    await expect(patch(ctx, { files: [f2.path] })).rejects.toThrow(/release\/Yuka\.exe: blob .* missing/)
    expect((await readCurrent()).build).toBe(1)
  })

  it('rejects a revision at or below the current highest', async () => {
    const f2 = await makeIpf(staging, 1116002)
    await patch(ctx, { files: [f2.path] })
    const f1 = await makeIpf(staging, 1116001)
    await expect(patch(ctx, { files: [f1.path] })).rejects.toThrow(/must be greater/)
    const same = await makeIpf(staging, 1116002)
    await expect(patch(ctx, { files: [same.path] })).rejects.toThrow(/must be greater/)
  })

  it('rejects files that are not patch archives', async () => {
    const bad = join(staging, 'not-a-patch.zip')
    await writeFile(bad, 'x')
    await expect(patch(ctx, { files: [bad] })).rejects.toThrow(/does not match/)
  })
})

describe('rollback', () => {
  it('re-points the Current Manifest at a stored Build', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game, label: 'good' })
    const f2 = await makeIpf(staging, 1116002)
    await patch(ctx, { files: [f2.path] })
    expect((await readCurrent()).build).toBe(2)

    store.ops.length = 0
    const m = await rollback(ctx, 1)

    expect(m.build).toBe(1)
    expect(m.label).toBe('good')
    expect(await readCurrent()).toEqual(await readStored(1))
    expect(store.ops).toEqual(['manifest.json'])
    expect(await readStored(2)).toMatchObject({ build: 2 })
  })

  it('never reuses a build number after a rollback', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    await release(ctx, { dir: t.game, label: 'two' })
    await rollback(ctx, 1)

    await release(ctx, { dir: t.game, label: 'three' })

    expect((await readCurrent()).build).toBe(3)
    expect((await readStored(2)).label).toBe('two')
    expect((await readStored(3)).label).toBe('three')
  })

  it('refuses unknown builds', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    await expect(rollback(ctx, 7)).rejects.toThrow(/no stored manifest for build 7/)
    await expect(rollback(ctx, Number.NaN)).rejects.toThrow(/integer/)
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
  it('passes on a consistent store', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    expect(await verify(ctx)).toEqual({ ok: true, problems: [] })
  })

  it('reports missing and size-mismatched Blobs', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    await truncate(join(out, 'objects', sha(t.bg.content)), 10)
    await rm(join(out, 'objects', sha(t.exe.content)))

    const result = await verify(ctx)

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      `data/bg.ipf: blob ${sha(t.bg.content)} has 10 bytes, manifest says 256`,
      `release/Yuka.exe: blob ${sha(t.exe.content)} missing from store`,
    ])
  })

  it('--mirror passes when the folder that was released is unchanged', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    expect(await verify(ctx, { mirror: t.game })).toEqual({ ok: true, problems: [] })
  })

  it('--mirror reports files whose hash differs, are missing locally, or are not in the Manifest', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    const changed = await put(t.game, 'data/bg.ipf', randomBytes(256))
    await rm(t.exe.path)
    await put(t.game, 'data/extra.ipf')
    await put(t.game, 'release/screenshot/new.png') // hard-guarded: never a problem

    const result = await verify(ctx, { mirror: t.game })

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      `data/bg.ipf: mirror has ${sha(changed.content)}, manifest says ${sha(t.bg.content)}`,
      'data/extra.ipf: in mirror but not in manifest',
      'release/Yuka.exe: missing from mirror',
    ])
  })

  it('--mirror hashes every file for real: a rewrite that keeps size and mtime is still caught', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game }) // warms the hash cache for data/bg.ipf
    const st = await stat(t.bg.path)
    const changed = await put(t.game, 'data/bg.ipf', randomBytes(256))
    await utimes(t.bg.path, st.atime, st.mtime)
    const cacheBefore = await readFile(cfg.hashCache, 'utf8')

    const result = await verify(ctx, { mirror: t.game })

    expect(result.problems).toEqual([`data/bg.ipf: mirror has ${sha(changed.content)}, manifest says ${sha(t.bg.content)}`])
    expect(await readFile(cfg.hashCache, 'utf8')).toBe(cacheBefore)
  })

  it('--mirror still reports store problems alongside mirror problems', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    await rm(join(out, 'objects', sha(t.exe.content)))

    const result = await verify(ctx, { mirror: t.game })

    expect(result.problems).toEqual([`release/Yuka.exe: blob ${sha(t.exe.content)} missing from store`])
  })
})

describe('gc', () => {
  /** Three Builds; each one replaces `release/Yuka.exe`, so builds 1 and 2 each own one orphan-able Blob. */
  async function threeBuilds() {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game }) // build 1
    const exe2 = await put(t.game, 'release/Yuka.exe', randomBytes(300))
    await release(ctx, { dir: t.game }) // build 2
    const exe3 = await put(t.game, 'release/Yuka.exe', randomBytes(301))
    await release(ctx, { dir: t.game }) // build 3
    return { t, exe1: sha(t.exe.content), exe2: sha(exe2.content), exe3: sha(exe3.content) }
  }

  it('--keep 2 deletes exactly the Blobs only older Builds reference and every stored Manifest survives', async () => {
    const b = await threeBuilds()
    await put(out, `objects/${'f'.repeat(64)}`) // junk nobody references
    const before = (await store.list('objects/')).map((o) => o.key)
    expect(before).toHaveLength(7)

    const result = await gc(ctx, { keep: 2 })

    expect(result.kept).toEqual([3, 2])
    expect(result.deleted.sort()).toEqual([`objects/${b.exe1}`, `objects/${'f'.repeat(64)}`].sort())
    const after = (await store.list('objects/')).map((o) => o.key)
    expect(after).toEqual(before.filter((k) => !result.deleted.includes(k)))
    expect(after).toContain(`objects/${b.exe2}`)
    expect(after).toContain(`objects/${b.exe3}`)
    expect((await store.list('manifests/')).map((o) => o.key)).toEqual([
      'manifests/1.json',
      'manifests/2.json',
      'manifests/3.json',
    ])
    expect(await store.head('manifest.json')).not.toBeNull()
    expect(await verify(ctx)).toEqual({ ok: true, problems: [] })
    expect(store.deleted.every((k) => k.startsWith('objects/'))).toBe(true)
  })

  it('always keeps the Current Manifest build, even when it is older than the N newest', async () => {
    const b = await threeBuilds()
    await rollback(ctx, 1)

    const result = await gc(ctx, { keep: 1 })

    expect(result.kept).toEqual([3, 1])
    expect(result.deleted).toEqual([`objects/${b.exe2}`])
    expect(await verify(ctx)).toEqual({ ok: true, problems: [] })
    expect(await store.head(`objects/${b.exe3}`)).not.toBeNull()
  })

  it('--dry-run logs every deletion and performs none', async () => {
    const b = await threeBuilds()
    const dryCtx: Ctx = { ...ctx, store: new DryRunStore(store, (m) => logs.push(m)) }

    const result = await gc(dryCtx, { keep: 1 })

    expect(result.deleted.sort()).toEqual([`objects/${b.exe1}`, `objects/${b.exe2}`].sort())
    expect(logs.filter((l) => l.startsWith('[dry-run] would delete objects/'))).toHaveLength(2)
    expect(await store.list('objects/')).toHaveLength(6)
  })

  it('refuses a non-integer or non-positive keep count and a store without a Current Manifest', async () => {
    await expect(gc(ctx, { keep: 0 })).rejects.toThrow(/positive integer/)
    await expect(gc(ctx, { keep: 2.5 })).rejects.toThrow(/positive integer/)
    await expect(gc(ctx, { keep: 1 })).rejects.toThrow(/no manifest published/)
    expect(store.deleted).toEqual([])
  })

  it('refuses a config that puts Manifests, news or launcher files under the Blob prefix', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    for (const bad of [
      { manifestKey: 'objects/manifest.json' },
      { manifestsPrefix: 'objects/manifests/' },
      { newsKey: 'objects/news.json' },
      { launcherPrefix: 'objects/launcher/' },
    ]) {
      await expect(gc({ ...ctx, cfg: { ...cfg, ...bad } }, { keep: 1 })).rejects.toThrow(/objectsPrefix/)
    }
    expect(store.deleted).toEqual([])
  })
})

describe('LocalDirStore.delete', () => {
  it('removes the object, is idempotent, and leaves siblings alone', async () => {
    await store.putText('objects/aaa', 'a')
    await store.putText('objects/bbb', 'b')

    await store.delete('objects/aaa')
    await store.delete('objects/aaa')

    expect(await store.head('objects/aaa')).toBeNull()
    expect(await store.getText('objects/bbb')).toBe('b')
    expect(store.ops).toEqual(['objects/aaa', 'objects/bbb'])
    expect(store.deleted).toEqual(['objects/aaa', 'objects/aaa'])
  })
})

describe('dry-run', () => {
  it('release, patch and rollback log intents and write nothing', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })
    const dryCtx: Ctx = { ...ctx, store: new DryRunStore(store, (m) => logs.push(m)) }

    await put(t.game, 'data/new.ipf')
    await release(dryCtx, { dir: t.game })
    const f2 = await makeIpf(staging, 1116002)
    await patch(dryCtx, { files: [f2.path] })
    await rollback(dryCtx, 1)

    expect((await readCurrent()).build).toBe(1)
    expect(await store.getText('manifests/2.json')).toBeNull()
    expect(logs.filter((l) => l.includes('[dry-run]')).length).toBeGreaterThanOrEqual(6)
  })
})

describe('launcher publish', () => {
  it('uploads installers first and latest.yml last, and can gate minLauncherVersion via a new Build', async () => {
    const t = await makeGameTree()
    await release(ctx, { dir: t.game })

    const dist = await mkdtemp(join(tmpdir(), 'yufa-dist-'))
    await writeFile(join(dist, 'Yufa-Launcher-Setup-1.0.1.exe'), randomBytes(128))
    await writeFile(join(dist, 'Yufa-Launcher-Setup-1.0.1.exe.blockmap'), randomBytes(32))
    await writeFile(join(dist, 'latest.yml'), 'version: 1.0.1\n')

    await publishLauncher(ctx, dist, '1.0.1')

    const ymlIdx = store.ops.indexOf('launcher/latest.yml')
    const exeIdx = store.ops.indexOf('launcher/Yufa-Launcher-Setup-1.0.1.exe')
    expect(exeIdx).toBeGreaterThanOrEqual(0)
    expect(exeIdx).toBeLessThan(ymlIdx)

    const m = await readCurrent()
    expect(m.build).toBe(2)
    expect(m.minLauncherVersion).toBe('1.0.1')
    expect((await readStored(1)).minLauncherVersion).toBe('1.0.0')
  })

  it('refuses a dist dir without latest.yml', async () => {
    const dist = await mkdtemp(join(tmpdir(), 'yufa-dist-'))
    await expect(publishLauncher(ctx, dist)).rejects.toThrow(/latest\.yml not found/)
  })
})

describe('redist push', () => {
  /** The trimmed installer set as documented: vcredist/ and directx/ subfolders. */
  async function makeRedistDir(opts: { withoutCab?: boolean; without?: string; extra?: string } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'yufa-redist-'))
    const files = [
      'vcredist/vc_redist.x86.exe',
      'directx/DXSETUP.exe',
      'directx/DSETUP.dll',
      'directx/dsetup32.dll',
      'directx/dxupdate.cab',
      ...(opts.withoutCab ? [] : ['directx/Jun2010_d3dx9_43_x86.cab']),
      ...(opts.extra ? [opts.extra] : []),
    ].filter((f) => f !== opts.without)
    const written = new Map<string, Buffer>()
    for (const f of files) written.set(f, (await put(dir, f, randomBytes(512 + written.size))).content)
    return { dir, written }
  }

  it('uploads every file of the trimmed set, then writes redist/index.json last with sizes and hashes', async () => {
    const { dir, written } = await makeRedistDir()
    await redistPush(ctx, { dir })

    const ops = store.ops
    expect(ops.at(-1)).toBe('redist/index.json')
    expect(ops.slice(0, -1).sort()).toEqual([...written.keys()].map((f) => `redist/${f}`).sort())

    const index = redistIndexSchema.parse(JSON.parse((await store.getText('redist/index.json'))!))
    expect(index.runtimes.vcredist.entry).toBe('vcredist/vc_redist.x86.exe')
    expect(index.runtimes.directx.entry).toBe('directx/DXSETUP.exe')
    const listed = [...index.runtimes.vcredist.files, ...index.runtimes.directx.files]
    expect(listed.map((f) => f.path).sort()).toEqual([...written.keys()].sort())
    for (const f of listed) {
      expect(f.size).toBe(written.get(f.path)!.length)
      expect(f.sha256).toBe(sha(written.get(f.path)!))
    }
    expect(index.runtimes.directx.files.map((f) => f.path)).not.toContain('vcredist/vc_redist.x86.exe')
    expect(logs.at(-1)).toMatch(/redist published/)
  })

  it('refuses a folder missing a required installer file, before uploading anything', async () => {
    for (const without of ['vcredist/vc_redist.x86.exe', 'directx/DXSETUP.exe', 'directx/dxupdate.cab']) {
      const { dir } = await makeRedistDir({ without })
      await expect(redistPush(ctx, { dir })).rejects.toThrow(without.split('/').pop()!)
    }
    const { dir } = await makeRedistDir({ withoutCab: true })
    await expect(redistPush(ctx, { dir })).rejects.toThrow(/d3dx9_43_x86\.cab/)
    expect(store.ops).toEqual([])
  })

  it('ignores files outside the two runtime folders', async () => {
    const { dir } = await makeRedistDir({ extra: 'README.txt' })
    await redistPush(ctx, { dir })
    expect(store.ops).not.toContain('redist/README.txt')
  })

  it('--dry-run logs every upload and writes nothing', async () => {
    const { dir } = await makeRedistDir()
    const dry: string[] = []
    await redistPush({ cfg, store: new DryRunStore(store, (m) => dry.push(m)), log: () => {} }, { dir })
    expect(dry.filter((m) => m.includes('would upload'))).toHaveLength(6)
    expect(dry.at(-1)).toMatch(/would write redist\/index\.json/)
    expect(store.ops).toEqual([])
  })
})
