import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { manifestSchema, patchArchiveRevision, type Manifest } from '../packages/shared/src/index'
import { loadConfig } from '../packages/publish-cli/src/config'
import { buildSandbox, bumpSandbox, sandboxPaths } from './e2e-setup'

let base: string
const url = 'http://127.0.0.1:8787/'
const quiet = { log: () => {} }

beforeEach(async () => {
  base = join(await mkdtemp(join(tmpdir(), 'yufa-e2e-')), 'sandbox')
})

async function readCurrent(): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(join(sandboxPaths(base).storeDir, 'manifest.json'), 'utf8')))
}

describe('e2e-setup (fake game tree → release → local store)', () => {
  it('publishes Build 1 from a fake tree, leaving the game folder empty and the guarded junk unpublished', async () => {
    const result = await buildSandbox({ base, url, count: 2, size: 4096, ...quiet })

    const m = await readCurrent()
    expect(m.build).toBe(1)
    expect(m.blobBaseUrl).toBe(`${url}objects/`)
    const paths = m.files.map((f) => f.path)
    expect(paths).toContain('release/Yuka.exe')
    expect(paths).toContain('data/bg.ipf')
    expect(paths.filter((p) => patchArchiveRevision(p) !== null)).toHaveLength(2)
    expect(m.revision).toBe(Math.max(...paths.map((p) => patchArchiveRevision(p) ?? 0)))
    expect(m.files.find((f) => f.path === 'release/uilayout.xml')?.class).toBe('seed-once')
    expect(paths).not.toContain('release/user.xml')
    expect(paths).not.toContain('release/release.revision.txt')
    expect(paths.some((p) => p.startsWith('release/screenshot/'))).toBe(false)

    // the tree on disk really holds the junk the guard dropped
    expect(existsSync(join(sandboxPaths(base).treeDir, 'release', 'user.xml'))).toBe(true)

    // an empty game folder: the launcher must show the install panel, not "resume"
    expect(await readdir(sandboxPaths(base).gameDir)).toEqual([])

    expect(JSON.parse(await readFile(join(sandboxPaths(base).storeDir, 'news', 'news.json'), 'utf8')).posts.length).toBeGreaterThan(0)
    expect(result.manifestUrl).toBe(`${url}manifest.json`)
    expect(result.newsUrl).toBe(`${url}news/news.json`)
    expect(result.build).toBe(1)
  })

  it('writes a publish.config.json the CLI can use against the sandbox store', async () => {
    await buildSandbox({ base, url, count: 1, size: 1024, ...quiet })

    const cfg = loadConfig(sandboxPaths(base).configFile)
    expect(cfg.publicBaseUrl).toBe(url)
    expect(cfg.hashCache).toBe(join(base, 'hash-cache.json'))
  })

  it('--bump publishes Build 2 that changes exactly one file and adds one patch archive', async () => {
    await buildSandbox({ base, url, count: 2, size: 4096, ...quiet })
    const before = await readCurrent()

    const result = await bumpSandbox({ base, url, ...quiet })

    const after = await readCurrent()
    expect(result.build).toBe(2)
    expect(after.build).toBe(2)
    const byPath = (m: Manifest) => new Map(m.files.map((f) => [f.path, f.sha256]))
    const b = byPath(before)
    const a = byPath(after)
    const added = [...a.keys()].filter((p) => !b.has(p))
    const removed = [...b.keys()].filter((p) => !a.has(p))
    const changed = [...a.keys()].filter((p) => b.has(p) && b.get(p) !== a.get(p))
    expect(removed).toEqual([])
    expect(added).toHaveLength(1)
    expect(patchArchiveRevision(added[0]!)).toBe(before.revision + 1)
    expect(changed).toHaveLength(1)
    expect(after.revision).toBe(before.revision + 1)
    expect(result.changed).toBe(changed[0])
    expect(result.added).toBe(added[0])
    // Build 1 stays stored, so rollback 1 works
    expect(existsSync(join(sandboxPaths(base).storeDir, 'manifests', '1.json'))).toBe(true)
  })

  it('bumping twice keeps climbing: each bump adds the next revision', async () => {
    await buildSandbox({ base, url, count: 1, size: 1024, ...quiet })
    const first = await bumpSandbox({ base, url, ...quiet })
    const second = await bumpSandbox({ base, url, ...quiet })
    expect(second.build).toBe(3)
    expect(patchArchiveRevision(second.added)).toBe(patchArchiveRevision(first.added)! + 1)
  })

  it('--bump refuses a sandbox that was never set up', async () => {
    await expect(bumpSandbox({ base, url, ...quiet })).rejects.toThrow(/e2e-setup/)
  })
})
