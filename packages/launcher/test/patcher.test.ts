import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HASH_ON_CHECK_MAX_BYTES,
  INSTALL_RECORD_FILE,
  installRecordSchema,
  patchFileName,
  type InstallRecord,
  type Manifest,
  type PatcherProgressEvent,
} from '@yufa/shared'
import { DEFAULT_EXCLUDES, DEFAULT_SEED_ONCE } from '../../publish-cli/src/config'
import { patch as cliPatch, release as cliRelease, rollback as cliRollback, type Ctx } from '../../publish-cli/src/commands'
import type { PublishConfig } from '../../publish-cli/src/config'
import { LocalDirStore } from '../../publish-cli/src/store'
import { createDevServer, type DevServer } from '../../../tools/dev-server'
import { gamePaths, readLocalRevision } from '../src/main/localState'
import { Patcher, type PatcherDeps } from '../src/main/patcher'

let storeDir: string
let staging: string
let treeDir: string
let gameDir: string
let server: DevServer
let store: LocalDirStore
let cliCtx: Ctx
let cfg: PublishConfig

const engineOptions = { retries: 2, backoffMs: () => 1, progressIntervalMs: 5 }

const REV_A = 1116001
const REV_B = 1116002
const ARCHIVE_A = `patch/${patchFileName(REV_A)}`
const ARCHIVE_B = `patch/${patchFileName(REV_B)}`
const LAYOUT = 'release/uilayout.xml'
const EXE = 'release/Yuka.exe'

beforeEach(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'yufa-store-'))
  staging = await mkdtemp(join(tmpdir(), 'yufa-stage-'))
  treeDir = await mkdtemp(join(tmpdir(), 'yufa-tree-'))
  gameDir = join(await mkdtemp(join(tmpdir(), 'yufa-game-')), 'ToS Classic')

  server = await createDevServer({ root: storeDir })
  cfg = {
    bucket: 'test',
    endpoint: 'https://example.invalid',
    publicBaseUrl: `${server.url}/`,
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
  store = new LocalDirStore(storeDir)
  cliCtx = { cfg, store, log: () => {} }
})

afterEach(async () => {
  await server.close()
})

async function put(root: string, rel: string, content: Buffer | string): Promise<Buffer> {
  const buf = typeof content === 'string' ? Buffer.from(content) : content
  const abs = join(root, ...rel.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, buf)
  return buf
}

interface TreeOptions {
  /** Size in bytes of each Managed File, by path; defaults are small and distinct. */
  sizes?: Partial<Record<string, number>>
  withArchives?: boolean
}

/**
 * A small fake full game tree: data, patch, release with a Seed-once layout
 * file, plus hard-guarded and excluded junk the publisher must skip.
 * Returns the published content by game-relative path.
 */
async function makeGameTree(opts: TreeOptions = {}): Promise<Map<string, Buffer>> {
  const size = (path: string, fallback: number) => opts.sizes?.[path] ?? fallback
  const published = new Map<string, Buffer>()
  const managed = async (path: string, fallback: number) => {
    published.set(path, await put(treeDir, path, randomBytes(size(path, fallback))))
  }
  await managed('data/bg.ipf', 40 * 1024)
  await managed('data/ui.ipf', 8 * 1024)
  await managed(EXE, 4 * 1024)
  await managed('release/a.dll', 2 * 1024)
  if (opts.withArchives !== false) {
    await managed(ARCHIVE_A, 16 * 1024)
    await managed(ARCHIVE_B, 12 * 1024)
  }
  published.set(LAYOUT, await put(treeDir, LAYOUT, '<layout published="1"/>'))
  // hard-guarded: never published
  await put(treeDir, 'release/user.xml', '<user login="operator"/>')
  await put(treeDir, 'release/release.revision.txt', String(REV_B))
  await put(treeDir, 'release/screenshot/shot.png', randomBytes(64))
  await put(treeDir, `${ARCHIVE_B}.part`, randomBytes(8))
  // excluded by default config
  await put(treeDir, 'release/patch/junk.ipf', randomBytes(8))
  return published
}

async function publishTree(opts: TreeOptions = {}, ctx: Ctx = cliCtx) {
  const published = await makeGameTree(opts)
  const manifest = await cliRelease(ctx, { dir: treeDir })
  return { published, manifest }
}

function makePatcher(over: Partial<PatcherDeps> = {}) {
  return new Patcher({
    gameDir,
    manifestUrl: `${server.url}/manifest.json`,
    launcherVersion: '1.0.0',
    engineOptions,
    ...over,
  })
}

function local(rel: string): string {
  return join(gameDir, ...rel.split('/'))
}

async function readRecord(): Promise<InstallRecord> {
  return installRecordSchema.parse(JSON.parse(await readFile(join(gameDir, INSTALL_RECORD_FILE), 'utf8')))
}

/** Paths of the Blobs a server requested, in request order, resolved through the manifest. */
function requestedPaths(requests: DevServer['requests'], manifest: Manifest): string[] {
  const byHash = new Map(manifest.files.map((f) => [f.sha256, f.path]))
  return requests
    .filter((r) => r.path.startsWith('/objects/'))
    .map((r) => byHash.get(r.path.slice('/objects/'.length)) ?? r.path)
}

/** Every file under the game folder with its size and mtime: what a check must leave alone. */
async function snapshot(): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const out = new Map<string, { size: number; mtimeMs: number }>()
  const walk = async (dir: string, rel: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name)
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(child, childRel)
      else {
        const st = await fs.stat(child)
        out.set(childRel, { size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  await walk(gameDir, '')
  return out
}

/** Overwrites a file with `content` keeping its mtime: the corruption a stat cannot see. */
async function corruptInPlace(path: string, content: Buffer) {
  const st = await fs.stat(path)
  await writeFile(path, content)
  await fs.utimes(path, st.atimeMs / 1000, st.mtimeMs / 1000)
}

async function installFresh(over: Partial<PatcherDeps> = {}) {
  const p = makePatcher(over)
  expect((await p.check()).state).toBe('not-installed')
  expect((await p.install()).state).toBe('ready')
}

describe('Install into an empty folder (publish CLI → dev server → patcher → temp game folder)', () => {
  it('reports not-installed, installs the whole Build, records it and ends ready', async () => {
    const { published, manifest } = await publishTree()
    const states: string[] = []
    const progress: PatcherProgressEvent[] = []
    const p = makePatcher({ onState: (e) => states.push(e.state), onProgress: (e) => progress.push(e) })

    const checked = await p.check()
    expect(checked.state).toBe('not-installed')
    expect(checked.plan).toMatchObject({ fileCount: 7, deleteCount: 0, targetRevision: REV_B, localRevision: 0 })
    expect(checked.plan!.totalBytes).toBe([...published.values()].reduce((s, b) => s + b.length, 0))

    const done = await p.install()
    expect(done.state).toBe('ready')
    expect(states).toEqual(['checking', 'not-installed', 'installing', 'verifying', 'ready'])
    expect(progress.some((e) => e.phase === 'downloading' && e.overallTotal === checked.plan!.totalBytes)).toBe(true)

    for (const [path, content] of published) {
      expect((await readFile(local(path))).equals(content), path).toBe(true)
    }
    expect(existsSync(local('release/user.xml'))).toBe(false)
    expect(existsSync(local('release/screenshot/shot.png'))).toBe(false)
    expect(existsSync(local('release/patch/junk.ipf'))).toBe(false)
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B)

    const record = await readRecord()
    expect(record).toMatchObject({ build: manifest.build, completed: true, seeded: [LAYOUT] })
    const managed = manifest.files.filter((f) => f.class === 'managed')
    expect(record.files.map((f) => f.path).sort()).toEqual(managed.map((f) => f.path).sort())
    for (const f of record.files) {
      const st = await fs.stat(local(f.path))
      expect({ size: st.size, mtimeMs: Math.floor(st.mtimeMs) }).toEqual({ size: f.size, mtimeMs: f.mtimeMs })
      expect(f.sha256).toBe(managed.find((m) => m.path === f.path)!.sha256)
    }
    expect(existsSync(join(gameDir, `${INSTALL_RECORD_FILE}.tmp`))).toBe(false)
    expect((await fs.readdir(gameDir)).some((n) => n.endsWith('.part'))).toBe(false)
  })

  it('downloads smallest files first, patch archives ascending by revision among themselves', async () => {
    const { manifest } = await publishTree({
      sizes: { [ARCHIVE_A]: 30 * 1024, [ARCHIVE_B]: 1024, 'release/a.dll': 512, 'data/bg.ipf': 50 * 1024 },
    })
    await installFresh({ downloadConcurrency: () => 1 })
    // by size: layout, a.dll, [1 KB archive], exe, ui, [30 KB archive], bg —
    // and the archive slots are filled in revision order, whatever their size
    expect(requestedPaths(server.requests, manifest)).toEqual([
      LAYOUT,
      'release/a.dll',
      ARCHIVE_A,
      EXE,
      'data/ui.ipf',
      ARCHIVE_B,
      'data/bg.ipf',
    ])
  })

  it('a second check after installing is up-to-date and writes nothing new', async () => {
    await publishTree()
    await installFresh()
    const before = await readRecord()
    const p = makePatcher()
    expect((await p.check()).state).toBe('up-to-date')
    expect(await readRecord()).toEqual(before)
  })

  it('advances release.revision.txt as patch archives land and ends at the manifest revision', async () => {
    await publishTree()
    const seen: number[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input).includes('/objects/')) seen.push((await readLocalRevision(gamePaths(gameDir))) ?? -1)
      return fetch(input, init)
    }
    await installFresh({ fetchImpl, downloadConcurrency: () => 1 })
    // Blob requests in download order: layout, a.dll, exe, ui.ipf, archive A, archive B, bg.ipf;
    // each entry is what the revision file said when that request went out
    expect(seen.slice(0, 5)).toEqual([-1, -1, -1, -1, -1]) // nothing written before the first archive completes
    expect(seen[5]).toBe(REV_A) // archive A landed
    expect(seen[6]).toBe(REV_B) // archive B landed
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B)
  })

  it('revision is 0 when the Build has no patch archives', async () => {
    await publishTree({ withArchives: false })
    await installFresh()
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(0)
    expect(existsSync(local('patch'))).toBe(false)
  })

  it('interrupted after N files: a fresh patcher plans exactly the rest and never re-fetches a finished file', async () => {
    const { manifest, published } = await publishTree()
    const N = 3
    let objectRequests = 0
    let p: Patcher
    const fetchImpl: typeof fetch = (input, init) => {
      if (String(input).includes('/objects/') && ++objectRequests > N) p.cancel()
      return fetch(input, init)
    }
    p = makePatcher({ fetchImpl, downloadConcurrency: () => 1 })
    await p.check()
    expect((await p.install()).state).toBe('idle')

    const partial = await readRecord()
    expect(partial.completed).toBe(false)
    expect(partial.files.length + partial.seeded.length).toBe(N)
    const finished = requestedPaths(server.requests, manifest).slice(0, N)
    server.requests.length = 0

    const p2 = makePatcher()
    const checked = await p2.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan!.fileCount).toBe(manifest.files.length - N)
    expect((await p2.update()).state).toBe('ready')

    const resumed = requestedPaths(server.requests, manifest)
    expect(resumed).toHaveLength(manifest.files.length - N)
    expect(resumed.filter((path) => finished.includes(path))).toEqual([])
    for (const [path, content] of published) {
      expect((await readFile(local(path))).equals(content), path).toBe(true)
    }
    expect((await readRecord()).completed).toBe(true)
  })

  it('a file renamed into place just before a crash (not yet in the record) is hashed, not fetched again', async () => {
    const { manifest } = await publishTree()
    await installFresh()
    // forge the crash window: the record forgets one installed file and the Build is not complete
    const record = await readRecord()
    const forgotten = record.files.find((f) => f.path === 'data/bg.ipf')!
    await writeFile(
      join(gameDir, INSTALL_RECORD_FILE),
      JSON.stringify({ ...record, completed: false, files: record.files.filter((f) => f !== forgotten) }),
    )
    server.requests.length = 0

    const events: PatcherProgressEvent[] = []
    const checked = await makePatcher({ onProgress: (e) => events.push(e) }).check()
    expect(checked.state).toBe('up-to-date')
    expect(requestedPaths(server.requests, manifest)).toEqual([])
    expect(events.some((e) => e.phase === 'hashing' && e.file === 'data/bg.ipf')).toBe(true)
    const healed = await readRecord()
    expect(healed.completed).toBe(true)
    expect(healed.files.find((f) => f.path === 'data/bg.ipf')).toEqual(forgotten)
  })

  it('a large file the record forgot is hashed once, recorded, then trusted by its stat', async () => {
    await publishTree({ sizes: { 'data/bg.ipf': HASH_ON_CHECK_MAX_BYTES + 1 } })
    await installFresh()
    const record = await readRecord()
    await writeFile(
      join(gameDir, INSTALL_RECORD_FILE),
      JSON.stringify({ ...record, files: record.files.filter((f) => f.path !== 'data/bg.ipf') }),
    )

    const first: PatcherProgressEvent[] = []
    expect((await makePatcher({ onProgress: (e) => first.push(e) }).check()).state).toBe('up-to-date')
    expect(first.some((e) => e.phase === 'hashing' && e.file === 'data/bg.ipf')).toBe(true)
    expect(await readRecord()).toEqual(record)

    const second: PatcherProgressEvent[] = []
    expect((await makePatcher({ onProgress: (e) => second.push(e) }).check()).state).toBe('up-to-date')
    expect(second.some((e) => e.file === 'data/bg.ipf')).toBe(false)
  })

  it('cancel keeps the .part and the partial record; the next run resumes with Range', async () => {
    const slowStoreDir = await mkdtemp(join(tmpdir(), 'yufa-slowstore-'))
    const slowServer = await createDevServer({ root: slowStoreDir, throttleBytesPerSec: 128 * 1024 })
    try {
      const slowCtx: Ctx = { cfg: { ...cfg, publicBaseUrl: `${slowServer.url}/` }, store: new LocalDirStore(slowStoreDir), log: () => {} }
      const { published } = await publishTree({ sizes: { 'data/bg.ipf': 512 * 1024 } }, slowCtx)
      const deps = { manifestUrl: `${slowServer.url}/manifest.json`, downloadConcurrency: () => 1 }

      const p = makePatcher(deps)
      expect((await p.check()).state).toBe('not-installed')
      const installing = p.install()
      setTimeout(() => p.cancel(), 600)
      expect((await installing).state).toBe('idle')

      expect(existsSync(local('data/bg.ipf.part'))).toBe(true)
      const partial = await readRecord()
      expect(partial.completed).toBe(false)
      expect(partial.files.length).toBeGreaterThan(0)

      const p2 = makePatcher(deps)
      expect((await p2.check()).state).toBe('update-available')
      expect((await p2.update()).state).toBe('ready')
      expect(slowServer.requests.some((r) => r.range && r.path.startsWith('/objects/'))).toBe(true)
      expect((await readFile(local('data/bg.ipf'))).equals(published.get('data/bg.ipf')!)).toBe(true)
    } finally {
      await slowServer.close()
    }
  })

  it('a folder with only the client executable is a valid but incomplete install: healed, Seed-once left alone', async () => {
    const { published } = await publishTree()
    await put(gameDir, EXE, 'old stub client')
    await put(gameDir, LAYOUT, '<layout mine="1"/>')

    await put(gameDir, 'release/a.dll', published.get('release/a.dll')!) // one file already right

    const p = makePatcher()
    const checked = await p.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan!.fileCount).toBe(5) // every other Managed File; the layout is already there
    expect((await readRecord()).files.map((f) => f.path)).toEqual(['release/a.dll'])
    expect((await p.update()).state).toBe('ready')
    expect((await readFile(local(EXE))).equals(published.get(EXE)!)).toBe(true)
    expect(await readFile(local(LAYOUT), 'utf8')).toBe('<layout mine="1"/>')
    const record = await readRecord()
    expect(record.seeded).toEqual([])
    expect(record.files.map((f) => f.path).sort()).toEqual(
      [...published.keys()].filter((k) => k !== LAYOUT).sort(),
    )
  })

  it('a corrupt Install Record counts as absent and triggers a not-installed on an otherwise empty folder', async () => {
    await publishTree()
    await put(gameDir, INSTALL_RECORD_FILE, '{ not json')
    expect((await makePatcher().check()).state).toBe('not-installed')
  })
})

describe('Updating an installed Build', () => {
  it('a new patch archive is picked up incrementally', async () => {
    await publishTree()
    await installFresh()

    const next = join(staging, patchFileName(REV_B + 1))
    await writeFile(next, randomBytes(3 * 1024))
    await cliPatch(cliCtx, { files: [next] })

    const p = makePatcher()
    const checked = await p.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan).toMatchObject({ fileCount: 1, targetRevision: REV_B + 1, localRevision: REV_B })
    expect((await p.update()).state).toBe('ready')
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B + 1)
    expect((await readRecord()).build).toBe(2)
  })

  it('a new release that changes one file and adds one patch archive downloads exactly those two', async () => {
    await publishTree()
    await installFresh()

    const dll = await put(treeDir, 'release/a.dll', randomBytes(2 * 1024))
    const archiveC = `patch/${patchFileName(REV_B + 1)}`
    const archive = await put(treeDir, archiveC, randomBytes(5 * 1024))
    const manifest = await cliRelease(cliCtx, { dir: treeDir })
    expect(manifest.build).toBe(2)
    server.requests.length = 0

    const p = makePatcher()
    const checked = await p.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan).toMatchObject({ fileCount: 2, deleteCount: 0, totalBytes: dll.length + archive.length })
    expect((await p.update()).state).toBe('ready')
    expect(requestedPaths(server.requests, manifest).sort()).toEqual(['release/a.dll', archiveC].sort())
    expect((await readFile(local('release/a.dll'))).equals(dll)).toBe(true)
    expect((await readFile(local(archiveC))).equals(archive)).toBe(true)
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B + 1)
    expect((await readRecord()).build).toBe(2)
  })

  it('server-side rollback deletes only recorded files, lowers the revision and leaves Player-owned files alone', async () => {
    await publishTree()
    const next = join(staging, patchFileName(REV_B + 1))
    await writeFile(next, randomBytes(3 * 1024))
    await cliPatch(cliCtx, { files: [next] })
    await installFresh()
    // Player-owned: same directories as Managed Files, never recorded
    await put(gameDir, 'release/user.xml', '<user login="player"/>')
    await put(gameDir, 'release/screenshot/shot.png', 'png')
    await put(gameDir, 'data/my_addon.ipf', 'addon')
    await put(gameDir, 'patch/notes.txt', 'mine')

    await cliRollback(cliCtx, 1)
    const p = makePatcher()
    const checked = await p.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan).toMatchObject({ fileCount: 0, deleteCount: 1 })
    expect((await p.update()).state).toBe('ready')
    expect(existsSync(local(`patch/${patchFileName(REV_B + 1)}`))).toBe(false)
    expect(await readFile(local('release/user.xml'), 'utf8')).toBe('<user login="player"/>')
    expect(await readFile(local('release/screenshot/shot.png'), 'utf8')).toBe('png')
    expect(await readFile(local('data/my_addon.ipf'), 'utf8')).toBe('addon')
    expect(await readFile(local('patch/notes.txt'), 'utf8')).toBe('mine')
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B)
    const record = await readRecord()
    expect(record.build).toBe(1)
    expect(record.files.some((f) => f.path.endsWith(patchFileName(REV_B + 1)))).toBe(false)
  })

  it('a seeded Seed-once File is never re-downloaded, verified or deleted, whatever changes locally or in the manifest', async () => {
    await publishTree()
    await installFresh()
    await put(gameDir, LAYOUT, '<layout mine="1"/>')

    // the manifest's copy changes in a new Build
    await put(treeDir, LAYOUT, '<layout published="2"/>')
    const manifest = await cliRelease(cliCtx, { dir: treeDir })
    expect(manifest.build).toBe(2)
    server.requests.length = 0
    const checked = await makePatcher().check()
    expect(checked.state).toBe('up-to-date')
    expect(requestedPaths(server.requests, manifest)).toEqual([])
    expect(await readFile(local(LAYOUT), 'utf8')).toBe('<layout mine="1"/>')
    expect((await readRecord()).build).toBe(2)

    // the game (or the player) removes it: still not re-seeded, by check or by Repair
    await fs.rm(local(LAYOUT))
    expect((await makePatcher().check()).state).toBe('up-to-date')
    expect((await makePatcher().repair()).state).toBe('up-to-date')
    expect(existsSync(local(LAYOUT))).toBe(false)
    expect(requestedPaths(server.requests, manifest)).toEqual([])
    expect((await readRecord()).seeded).toEqual([LAYOUT])
  })

  it('a small file corrupted in place (same size, same mtime) is caught by a normal check and healed', async () => {
    const { published } = await publishTree()
    await installFresh()

    const evil = Buffer.from(published.get('release/a.dll')!)
    evil[0]! ^= 0xff
    await corruptInPlace(local('release/a.dll'), evil)

    const events: PatcherProgressEvent[] = []
    const p = makePatcher({ onProgress: (e) => events.push(e) })
    const checked = await p.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan).toMatchObject({ fileCount: 1, deleteCount: 0 })
    expect(events.some((e) => e.phase === 'hashing')).toBe(true)
    expect((await p.update()).state).toBe('ready')
    expect((await readFile(local('release/a.dll'))).equals(published.get('release/a.dll')!)).toBe(true)
  })

  it('a large file corrupted in place passes a normal check; Repair detects and heals it, leaving other files alone', async () => {
    const { published } = await publishTree({ sizes: { 'data/bg.ipf': HASH_ON_CHECK_MAX_BYTES + 1 } })
    await installFresh()
    await put(gameDir, 'release/user.xml', '<user login="player"/>')
    await put(gameDir, LAYOUT, '<layout mine="1"/>')

    const target = local('data/bg.ipf')
    const evil = Buffer.from(published.get('data/bg.ipf')!)
    evil[0]! ^= 0xff
    await corruptInPlace(target, evil)

    expect((await makePatcher().check()).state).toBe('up-to-date')
    expect((await readFile(target)).equals(evil)).toBe(true)

    const events: PatcherProgressEvent[] = []
    const states: string[] = []
    const p = makePatcher({ onProgress: (e) => events.push(e), onState: (e) => states.push(e.state) })
    expect((await p.repair()).state).toBe('ready')
    expect(states.slice(0, 2)).toEqual(['checking', 'repairing'])
    expect((await readFile(target)).equals(published.get('data/bg.ipf')!)).toBe(true)
    const hashing = events.filter((e) => e.phase === 'hashing')
    expect(hashing.some((e) => e.file === 'data/bg.ipf')).toBe(true)
    expect(hashing.every((e) => e.overallTotal >= HASH_ON_CHECK_MAX_BYTES + 1)).toBe(true)
    expect(await readFile(local('release/user.xml'), 'utf8')).toBe('<user login="player"/>')
    expect(await readFile(local(LAYOUT), 'utf8')).toBe('<layout mine="1"/>')
  })

  it('a check on an up-to-date install writes nothing except a drifted release.revision.txt', async () => {
    await publishTree()
    await installFresh()
    const record = await readRecord()
    await writeFile(local('release/release.revision.txt'), '1')
    const before = await snapshot()

    const states: string[] = []
    expect((await makePatcher({ onState: (e) => states.push(e.state) }).check()).state).toBe('up-to-date')
    expect(states).toEqual(['checking', 'up-to-date'])
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B)
    expect(await readRecord()).toEqual(record)

    const after = await snapshot()
    before.delete('release/release.revision.txt')
    after.delete('release/release.revision.txt')
    expect(after).toEqual(before)
  })

  it('a failed file leaves the revision at the last complete archive, then recovers', async () => {
    const { manifest } = await publishTree()
    const p = makePatcher({ engineOptions: { retries: 0, backoffMs: () => 1, progressIntervalMs: 5 }, downloadConcurrency: () => 1 })
    await p.check()
    server.corruptNext(manifest.files.find((f) => f.path === ARCHIVE_B)!.sha256)

    const done = await p.install()
    expect(done.state).toBe('error')
    expect(done.error?.code).toBe('download-failed')
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_A)
    expect((await readRecord()).completed).toBe(false)

    const p2 = makePatcher()
    expect((await p2.check()).state).toBe('update-available')
    expect((await p2.update()).state).toBe('ready')
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B)
  })

  it('offline: a complete install may play offline, a partial one may not', async () => {
    await publishTree()
    const p = makePatcher()
    expect((await p.check()).state).toBe('not-installed')

    const notInstalled = makePatcher({ manifestUrl: 'http://127.0.0.1:1/manifest.json', manifestTimeoutMs: 500 })
    const ev0 = await notInstalled.check()
    expect(ev0.state).toBe('error')
    expect(ev0.error?.code).toBe('offline')
    expect(ev0.offlinePlayable).toBe(false)

    expect((await p.install()).state).toBe('ready')
    await server.close()
    const ev = await makePatcher().check()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('offline')
    expect(ev.offlinePlayable).toBe(true)

    const record = await readRecord()
    await writeFile(join(gameDir, INSTALL_RECORD_FILE), JSON.stringify({ ...record, completed: false }))
    expect((await makePatcher().check()).offlinePlayable).toBe(false)
  })

  it('gates on minLauncherVersion', async () => {
    await publishTree()
    const text = (await store.getText('manifest.json'))!
    await store.putText('manifest.json', text.replace('"minLauncherVersion": "1.0.0"', '"minLauncherVersion": "2.0.0"'))
    const ev = await makePatcher().check()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('launcher-outdated')
  })

  it('refuses to install or update while the game is running', async () => {
    await publishTree()
    const p = makePatcher({ isGameRunning: async () => true })
    await p.check()
    const ev = await p.install()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('game-running')

    await installFresh()
    const next = join(staging, patchFileName(REV_B + 1))
    await writeFile(next, randomBytes(1024))
    await cliPatch(cliCtx, { files: [next] })
    const p2 = makePatcher({ isGameRunning: async () => true })
    expect((await p2.check()).state).toBe('update-available')
    const ev2 = await p2.update()
    expect(ev2.state).toBe('error')
    expect(ev2.error?.code).toBe('game-running')
    expect(existsSync(local(`patch/${patchFileName(REV_B + 1)}`))).toBe(false)
  })

  it('reports manifest-cdn-desync when a listed Blob is missing (after one auto re-check)', async () => {
    const { manifest } = await publishTree()
    await installFresh()
    const next = join(staging, patchFileName(REV_B + 1))
    await writeFile(next, randomBytes(1024))
    const published = await cliPatch(cliCtx, { files: [next] })
    const added = published.files.find((f) => !manifest.files.some((m) => m.sha256 === f.sha256))!
    await fs.rm(join(storeDir, 'objects', added.sha256))

    const p = makePatcher()
    await p.check()
    server.requests.length = 0
    const ev = await p.update()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('manifest-cdn-desync')
    expect(server.requests.filter((r) => r.path.startsWith('/manifest.json')).length).toBe(1)
  })

  it('with parallel downloads, a higher archive finishing before a failed lower one does not advance the revision past the gap', async () => {
    const slowStoreDir = await mkdtemp(join(tmpdir(), 'yufa-slowstore-'))
    const slowServer = await createDevServer({ root: slowStoreDir, throttleBytesPerSec: 512 * 1024 })
    try {
      const slowCtx: Ctx = { cfg: { ...cfg, publicBaseUrl: `${slowServer.url}/` }, store: new LocalDirStore(slowStoreDir), log: () => {} }
      const { manifest } = await publishTree({ sizes: { [ARCHIVE_A]: 256 * 1024, [ARCHIVE_B]: 1024 } }, slowCtx)
      const deps: Partial<PatcherDeps> = { manifestUrl: `${slowServer.url}/manifest.json`, downloadConcurrency: () => 2 }

      const p = makePatcher({ ...deps, engineOptions: { retries: 0, backoffMs: () => 1, progressIntervalMs: 5 } })
      await p.check()
      slowServer.corruptNext(manifest.files.find((f) => f.path === ARCHIVE_A)!.sha256)

      expect((await p.install()).state).toBe('error')
      expect(existsSync(local(ARCHIVE_B))).toBe(true)
      expect(await readLocalRevision(gamePaths(gameDir))).toBeNull()

      const p2 = makePatcher(deps)
      await p2.check()
      expect((await p2.update()).state).toBe('ready')
      expect(await readLocalRevision(gamePaths(gameDir))).toBe(REV_B)
    } finally {
      await slowServer.close()
    }
  })
})
