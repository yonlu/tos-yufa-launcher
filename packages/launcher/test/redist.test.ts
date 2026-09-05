import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  REDIST_INDEX_FILE,
  REDIST_INDEX_SCHEMA_VERSION,
  REDIST_LAYOUT,
  type RedistIndex,
  type RedistRuntime,
  type RedistStatus,
} from '@yufa/shared'
import { createDevServer, type DevServer } from '../../../tools/dev-server'
import {
  elevatedRunScript,
  ensureRedistributables,
  probeWindowsRuntimes,
  RedistError,
  type RedistFlowDeps,
  type RedistInstaller,
} from '../src/main/redist'

let storeDir: string
let tempDir: string
let server: DevServer

const engineOptions = { retries: 1, backoffMs: () => 1, progressIntervalMs: 5 }

beforeEach(async () => {
  storeDir = await mkdtemp(join(tmpdir(), 'yufa-redist-store-'))
  tempDir = join(await mkdtemp(join(tmpdir(), 'yufa-redist-tmp-')), 'redist')
  server = await createDevServer({ root: storeDir })
})

afterEach(async () => {
  await server.close()
})

const DIRECTX_FILES = [...REDIST_LAYOUT.directx.required, 'directx/Jun2010_d3dx9_43_x86.cab']
const VCREDIST_FILES = [...REDIST_LAYOUT.vcredist.required]

/** Writes a trimmed installer set under redist/ and the index describing it; returns the index. */
async function serveRedist(tamper?: { path: string; sha256: string }): Promise<RedistIndex> {
  const entry = async (path: string) => {
    const content = randomBytes(1024 + Math.floor(Math.random() * 1024))
    const abs = join(storeDir, 'redist', ...path.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
    const sha256 = tamper?.path === path ? tamper.sha256 : createHash('sha256').update(content).digest('hex')
    return { path, size: content.length, sha256 }
  }
  const index: RedistIndex = {
    schemaVersion: REDIST_INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runtimes: {
      vcredist: { entry: REDIST_LAYOUT.vcredist.entry, files: await Promise.all(VCREDIST_FILES.map(entry)) },
      directx: { entry: REDIST_LAYOUT.directx.entry, files: await Promise.all(DIRECTX_FILES.map(entry)) },
    },
  }
  await writeFile(join(storeDir, 'redist', REDIST_INDEX_FILE), JSON.stringify(index))
  return index
}

interface Fakes {
  ran: RedistInstaller[][]
  statuses: RedistStatus[]
  deps: RedistFlowDeps
}

function fakes(present: Record<RedistRuntime, boolean>, runner?: RedistFlowDeps['runner']): Fakes {
  const ran: RedistInstaller[][] = []
  const statuses: RedistStatus[] = []
  return {
    ran,
    statuses,
    deps: {
      probe: async () => present,
      runner:
        runner ??
        (async (installers) => {
          ran.push(installers)
        }),
      indexUrl: `${server.url}/redist/${REDIST_INDEX_FILE}`,
      tempDir,
      engineOptions,
      onStatus: (s) => statuses.push(s),
    },
  }
}

function requested(): string[] {
  return server.requests.map((r) => r.path)
}

describe('ensureRedistributables (injected probe and runner)', () => {
  it('both runtimes present: nothing is downloaded and nothing runs', async () => {
    await serveRedist()
    const f = fakes({ vcredist: true, directx: true })
    const result = await ensureRedistributables(f.deps)
    expect(result).toEqual({ status: 'present', missing: [] })
    expect(f.ran).toEqual([])
    expect(requested()).toEqual([])
    expect(f.statuses).toEqual([])
  })

  it('one runtime missing: only its files are fetched and only its installer runs', async () => {
    const index = await serveRedist()
    const f = fakes({ vcredist: true, directx: false })
    const result = await ensureRedistributables(f.deps)
    expect(result).toEqual({ status: 'installed', missing: ['directx'] })

    const paths = requested()
    expect(paths[0]).toMatch(/^\/redist\/index\.json/)
    expect(paths.slice(1).sort()).toEqual(index.runtimes.directx.files.map((x) => `/redist/${x.path}`).sort())
    expect(paths.some((p) => p.includes('/vcredist/'))).toBe(false)

    expect(f.ran).toHaveLength(1)
    const [installers] = f.ran
    expect(installers!.map((i) => i.runtime)).toEqual(['directx'])
    expect(basename(installers![0]!.exe)).toBe('DXSETUP.exe')
    expect(installers![0]!.exe.startsWith(tempDir)).toBe(true)
    expect(installers![0]!.args).toEqual(['/silent'])

    expect(f.statuses).toEqual([
      { status: 'downloading', missing: ['directx'] },
      { status: 'installing', missing: ['directx'] },
    ])
  })

  it('both missing: one runner call with both installers, VC++ first', async () => {
    await serveRedist()
    const f = fakes({ vcredist: false, directx: false })
    const result = await ensureRedistributables(f.deps)
    expect(result).toEqual({ status: 'installed', missing: ['vcredist', 'directx'] })
    expect(f.ran).toHaveLength(1)
    const [installers] = f.ran
    expect(installers!.map((i) => [i.runtime, basename(i.exe), i.args])).toEqual([
      ['vcredist', 'vc_redist.x86.exe', ['/install', '/quiet', '/norestart']],
      ['directx', 'DXSETUP.exe', ['/silent']],
    ])
    expect(installers![0]!.okExitCodes).toContain(3010)
  })

  it('the temp area holds the files while the runner works and is gone afterwards', async () => {
    await serveRedist()
    let seenDuringRun: string[] = []
    const f = fakes({ vcredist: false, directx: true }, async (installers) => {
      seenDuringRun = installers.map((i) => i.exe).filter((p) => existsSync(p))
    })
    await ensureRedistributables(f.deps)
    expect(seenDuringRun).toHaveLength(1)
    expect(existsSync(tempDir)).toBe(false)
  })

  it('a declined administrator prompt is a warning: failed with elevation-declined', async () => {
    await serveRedist()
    const f = fakes({ vcredist: false, directx: false }, async () => {
      throw new RedistError('elevation-declined', 'The operation was canceled by the user')
    })
    const result = await ensureRedistributables(f.deps)
    expect(result.status).toBe('failed')
    expect(result.missing).toEqual(['vcredist', 'directx'])
    expect(result.error?.code).toBe('elevation-declined')
    expect(existsSync(tempDir)).toBe(false)
  })

  it('any other runner failure is a warning with redist-failed and the message', async () => {
    await serveRedist()
    const f = fakes({ vcredist: false, directx: true }, async () => {
      throw new Error('vcredist exited with 1603')
    })
    const result = await ensureRedistributables(f.deps)
    expect(result).toEqual({
      status: 'failed',
      missing: ['vcredist'],
      error: { code: 'redist-failed', message: 'vcredist exited with 1603' },
    })
  })

  it('a probe that throws is a warning too, never an error out of the flow', async () => {
    const f = fakes({ vcredist: true, directx: true })
    f.deps.probe = async () => {
      throw new Error('registry unreadable')
    }
    const result = await ensureRedistributables(f.deps)
    expect(result).toEqual({ status: 'failed', missing: [], error: { code: 'redist-failed', message: 'registry unreadable' } })
    expect(f.ran).toEqual([])
  })

  it('an unreachable index is a warning and nothing runs', async () => {
    const f = fakes({ vcredist: false, directx: false })
    const result = await ensureRedistributables(f.deps)
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('redist-failed')
    expect(f.ran).toEqual([])
  })

  it('a file whose content does not match the index is refused; nothing runs', async () => {
    await serveRedist({ path: REDIST_LAYOUT.directx.entry, sha256: '0'.repeat(64) })
    const f = fakes({ vcredist: true, directx: false })
    const result = await ensureRedistributables(f.deps)
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('redist-failed')
    expect(f.ran).toEqual([])
    expect(existsSync(tempDir)).toBe(false)
  })
})

describe('probeWindowsRuntimes', () => {
  it('looks for the 32-bit DLLs under SysWOW64', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yufa-sysroot-'))
    await mkdir(join(root, 'SysWOW64'), { recursive: true })
    await writeFile(join(root, 'SysWOW64', 'vcruntime140.dll'), 'x')
    expect(await probeWindowsRuntimes(root)).toEqual({ vcredist: true, directx: false })
    await writeFile(join(root, 'SysWOW64', 'd3dx9_43.dll'), 'x')
    expect(await probeWindowsRuntimes(root)).toEqual({ vcredist: true, directx: true })
  })

  it('falls back to System32 on a Windows without SysWOW64', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yufa-sysroot-'))
    await mkdir(join(root, 'System32'), { recursive: true })
    await writeFile(join(root, 'System32', 'd3dx9_43.dll'), 'x')
    expect(await probeWindowsRuntimes(root)).toEqual({ vcredist: false, directx: true })
  })
})

describe('elevatedRunScript', () => {
  it('runs each installer in order, waits, accepts its exit codes and records results', () => {
    const script = elevatedRunScript(
      [
        { runtime: 'vcredist', exe: "C:\\Temp\\it's\\vc_redist.x86.exe", args: ['/install', '/quiet'], okExitCodes: [0, 3010] },
        { runtime: 'directx', exe: 'C:\\Temp\\DXSETUP.exe', args: ['/silent'], okExitCodes: [0] },
      ],
      'C:\\Temp\\result.txt',
    )
    const vc = script.indexOf("'C:\\Temp\\it''s\\vc_redist.x86.exe'")
    const dx = script.indexOf("'C:\\Temp\\DXSETUP.exe'")
    expect(vc).toBeGreaterThan(-1)
    expect(dx).toBeGreaterThan(vc)
    expect(script).toContain("'/install','/quiet'")
    expect(script).toContain('-Wait')
    expect(script).toContain('@(0,3010) -notcontains')
    expect(script).toContain("'C:\\Temp\\result.txt'")
    expect(script.trim().endsWith('exit $failed')).toBe(true)
  })
})
