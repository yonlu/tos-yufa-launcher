import { createHash, randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GRANDFATHER_REVISION as GF, patchFileName, type PatcherProgressEvent } from '@yufa/shared'
import { DEFAULT_EXCLUDES, DEFAULT_SEED_ONCE } from '../../publish-cli/src/config'
import { patch as cliPatch, rollback as cliRollback, type Ctx } from '../../publish-cli/src/commands'
import type { PublishConfig } from '../../publish-cli/src/config'
import { LocalDirStore } from '../../publish-cli/src/store'
import { createDevServer, type DevServer } from '../../../tools/dev-server'
import { gamePaths, readLocalRevision } from '../src/main/localState'
import { Patcher, type PatcherDeps } from '../src/main/patcher'

let storeDir: string
let staging: string
let gameDir: string
let server: DevServer
let store: LocalDirStore
let cliCtx: Ctx
let cfg: PublishConfig

const engineOptions = { retries: 2, backoffMs: () => 1, progressIntervalMs: 5 }

beforeEach(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'yufa-store-'))
  staging = await mkdtemp(join(tmpdir(), 'yufa-stage-'))
  gameDir = await mkdtemp(join(tmpdir(), 'yufa-game-'))
  await mkdir(join(gameDir, 'patch'), { recursive: true })
  await mkdir(join(gameDir, 'release'), { recursive: true })
  await writeFile(join(gameDir, 'release', 'release.revision.txt'), String(GF))
  await writeFile(join(gameDir, 'release', 'Yuka.exe'), 'stub')
  await writeFile(join(gameDir, 'patch', patchFileName(11072)), randomBytes(64)) // grandfathered base file

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

/** Publishes one Build with the given archives; returns each archive's sha256 by revision. */
async function publishRevisions(revisions: number[], size = 32 * 1024, ctx: Ctx = cliCtx) {
  const paths: string[] = []
  const hashes = new Map<number, string>()
  for (const rev of revisions) {
    const p = join(staging, patchFileName(rev))
    const content = randomBytes(size)
    await writeFile(p, content)
    hashes.set(rev, createHash('sha256').update(content).digest('hex'))
    paths.push(p)
  }
  await cliPatch(ctx, { files: paths })
  return hashes
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

describe('Patcher integration (publish CLI → dev server → patcher → fixture game dir)', () => {
  it('publish → check → update applies patches and advances the revision file', async () => {
    await publishRevisions([GF + 1, GF + 2])

    const states: string[] = []
    const p = makePatcher({ onState: (e) => states.push(e.state) })

    const checked = await p.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan).toMatchObject({ fileCount: 2, targetRevision: GF + 2, localRevision: GF })

    const done = await p.update()
    expect(done.state).toBe('ready')
    expect(existsSync(join(gameDir, 'patch', patchFileName(GF + 1)))).toBe(true)
    expect(existsSync(join(gameDir, 'patch', patchFileName(GF + 2)))).toBe(true)
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(GF + 2)
    expect(states).toEqual(['checking', 'update-available', 'updating', 'verifying', 'ready'])

    const local = await readFile(join(gameDir, 'patch', patchFileName(GF + 1)))
    const published = await readFile(join(staging, patchFileName(GF + 1)))
    expect(local.equals(published)).toBe(true)
  })

  it('second check is up-to-date; a new publish is picked up incrementally', async () => {
    await publishRevisions([GF + 1])
    let p = makePatcher()
    await p.check()
    await p.update()

    p = makePatcher()
    expect((await p.check()).state).toBe('up-to-date')

    await publishRevisions([GF + 2])
    p = makePatcher()
    const checked = await p.check()
    expect(checked.state).toBe('update-available')
    expect(checked.plan!.fileCount).toBe(1)
    await p.update()
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(GF + 2)
  })

  it('server-side rollback deletes local files and lowers the revision', async () => {
    await publishRevisions([GF + 1]) // build 1
    await publishRevisions([GF + 2]) // build 2
    let p = makePatcher()
    await p.check()
    await p.update()

    await cliRollback(cliCtx, 1)
    p = makePatcher()
    expect((await p.check()).state).toBe('update-available')
    const done = await p.update()
    expect(done.state).toBe('ready')
    expect(existsSync(join(gameDir, 'patch', patchFileName(GF + 2)))).toBe(false)
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(GF + 1)
  })

  it('repair detects silent corruption that a normal check cannot see', async () => {
    await publishRevisions([GF + 1])
    let p = makePatcher()
    await p.check()
    await p.update()

    const target = join(gameDir, 'patch', patchFileName(GF + 1))
    const original = await readFile(target)
    const evil = Buffer.from(original)
    evil[0]! ^= 0xff
    await writeFile(target, evil) // same size, different content

    p = makePatcher()
    expect((await p.check()).state).toBe('up-to-date')

    const events: PatcherProgressEvent[] = []
    p = makePatcher({ onProgress: (e) => events.push(e) })
    const done = await p.repair()
    expect(done.state).toBe('ready')
    expect((await readFile(target)).equals(original)).toBe(true)
    expect(events.some((e) => e.phase === 'hashing')).toBe(true)
  })

  it('a failed file leaves the game at the last good revision, then recovers', async () => {
    const hashes = await publishRevisions([GF + 1, GF + 2])
    const p = makePatcher({ engineOptions: { retries: 0, backoffMs: () => 1, progressIntervalMs: 5 } })
    await p.check()
    server.corruptNext(hashes.get(GF + 2)!)

    const done = await p.update()
    expect(done.state).toBe('error')
    expect(done.error?.code).toBe('download-failed')
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(GF + 1)
    expect(existsSync(join(gameDir, 'patch', patchFileName(GF + 1)))).toBe(true)

    const p2 = makePatcher()
    await p2.check()
    expect((await p2.update()).state).toBe('ready')
    expect(await readLocalRevision(gamePaths(gameDir))).toBe(GF + 2)
  })

  it('offline: reports offline but allows playing the existing install', async () => {
    await publishRevisions([GF + 1])
    const p = makePatcher()
    await p.check()
    await p.update()

    await server.close()
    const p2 = makePatcher()
    const ev = await p2.check()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('offline')
    expect(ev.offlinePlayable).toBe(true)
  })

  it('gates on minLauncherVersion', async () => {
    await publishRevisions([GF + 1])
    const text = (await store.getText('manifest.json'))!
    await store.putText('manifest.json', text.replace('"minLauncherVersion": "1.0.0"', '"minLauncherVersion": "2.0.0"'))

    const ev = await makePatcher().check()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('launcher-outdated')
  })

  it('refuses to update while the game is running', async () => {
    await publishRevisions([GF + 1])
    const p = makePatcher({ isGameRunning: async () => true })
    await p.check()
    const ev = await p.update()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('game-running')
  })

  it('reports manifest-cdn-desync when a listed object is missing (after one auto re-check)', async () => {
    const hashes = await publishRevisions([GF + 1])
    await fs.rm(join(storeDir, 'objects', hashes.get(GF + 1)!))

    const p = makePatcher()
    await p.check()
    const ev = await p.update()
    expect(ev.state).toBe('error')
    expect(ev.error?.code).toBe('manifest-cdn-desync')
  })

  it('cancel aborts mid-download, keeps the .part, and a later run resumes with Range', async () => {
    const slowStoreDir = await mkdtemp(join(tmpdir(), 'yufa-slowstore-'))
    const slowServer = await createDevServer({ root: slowStoreDir, throttleBytesPerSec: 128 * 1024 })
    try {
      const slowCfg = { ...cfg, publicBaseUrl: `${slowServer.url}/` }
      const slowCtx: Ctx = { cfg: slowCfg, store: new LocalDirStore(slowStoreDir), log: () => {} }
      await publishRevisions([GF + 1], 512 * 1024, slowCtx)

      const p = makePatcher({ manifestUrl: `${slowServer.url}/manifest.json` })
      expect((await p.check()).state).toBe('update-available')
      const updating = p.update()
      setTimeout(() => p.cancel(), 300)
      const ev = await updating
      expect(ev.state).toBe('idle')

      const part = join(gameDir, 'patch', `${patchFileName(GF + 1)}.part`)
      expect(existsSync(part)).toBe(true)

      const p2 = makePatcher({ manifestUrl: `${slowServer.url}/manifest.json` })
      await p2.check()
      expect((await p2.update()).state).toBe('ready')
      expect(await readLocalRevision(gamePaths(gameDir))).toBe(GF + 1)
      expect(slowServer.requests.some((r) => r.range && r.path.startsWith('/objects/'))).toBe(true)
    } finally {
      await slowServer.close()
    }
  })
})
