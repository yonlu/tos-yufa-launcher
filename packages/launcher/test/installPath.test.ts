import { promises as fs } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { INSTALL_RECORD_FILE, emptyInstallRecord } from '@yufa/shared'
import { DISK_SPACE_MARGIN_BYTES } from '../src/main/download'
import {
  isUnderAny,
  probeDirCreatable,
  systemForbiddenRoots,
  validateInstallPath,
  type InstallPathDeps,
} from '../src/main/installPath'

let base: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'yufa-install-path-'))
})

const TB = 1_000_000_000_000

/** Every disk seam stubbed: a forbidden set, a roomy drive, a writable anchor. Tests override what they exercise. */
function deps(over: Partial<InstallPathDeps> = {}): InstallPathDeps {
  return {
    forbiddenRoots: ['C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Windows'],
    freeBytes: async () => TB,
    probeWritable: async () => true,
    ...over,
  }
}

describe('forbidden locations', () => {
  it('matches the folder itself and anything below it, ignoring case and separators', () => {
    const roots = ['C:\\Program Files', 'C:\\Windows']
    expect(isUnderAny('C:\\Program Files', roots)).toBe(true)
    expect(isUnderAny('c:/program files/Hyped Games/ToS', roots)).toBe(true)
    expect(isUnderAny('C:\\WINDOWS\\Temp\\tos', roots)).toBe(true)
    expect(isUnderAny('C:\\Program Files Extra\\tos', roots)).toBe(false)
    expect(isUnderAny('D:\\Program Files\\tos', roots)).toBe(false)
    expect(isUnderAny('C:\\Hyped Games\\ToS Classic', roots)).toBe(false)
  })

  it('derives the roots from the Program Files and Windows environment variables, deduplicated', () => {
    const roots = systemForbiddenRoots({
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      ProgramW6432: 'C:\\Program Files',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\WINDOWS',
    })
    expect(roots.map((r) => r.toLowerCase()).sort()).toEqual([
      'c:\\program files',
      'c:\\program files (x86)',
      'c:\\windows',
    ])
  })
})

describe('probeDirCreatable', () => {
  it('says yes for a writable folder and leaves nothing behind', async () => {
    expect(await probeDirCreatable(base)).toBe(true)
    expect(await fs.readdir(base)).toEqual([])
  })

  it('says no where a folder cannot be created', async () => {
    expect(await probeDirCreatable(join(base, 'does-not-exist'))).toBe(false)
  })
})

describe('validateInstallPath', () => {
  it('accepts a folder that does not exist yet under a writable drive and reports free and required bytes', async () => {
    const target = join(base, 'Hyped Games', 'ToS Classic')
    const check = await validateInstallPath(target, 5_000_000_000, deps())
    expect(check).toEqual({
      path: target,
      ok: true,
      problems: [],
      freeBytes: TB,
      requiredBytes: 5_000_000_000 + DISK_SPACE_MARGIN_BYTES,
      existing: 'none',
    })
  })

  it('rejects a relative or empty path as invalid without touching the disk', async () => {
    expect((await validateInstallPath('', 1, deps())).problems).toEqual(['invalid'])
    expect((await validateInstallPath('  ', 1, deps())).problems).toEqual(['invalid'])
    expect((await validateInstallPath('Hyped Games\\ToS', 1, deps())).problems).toEqual(['invalid'])
  })

  it('rejects a folder under Program Files or Windows with the forbidden reason', async () => {
    const check = await validateInstallPath('C:\\Program Files (x86)\\ToS Classic', 1, deps())
    expect(check.ok).toBe(false)
    expect(check.problems).toEqual(['forbidden'])
  })

  it('probes the deepest folder that exists today, and rejects when it refuses a new folder', async () => {
    const target = join(base, 'locked', 'ToS Classic')
    const probed: string[] = []
    const check = await validateInstallPath(
      target,
      1,
      deps({
        probeWritable: async (dir) => {
          probed.push(dir)
          return false
        },
      }),
    )
    expect(check.problems).toEqual(['not-writable'])
    expect(probed).toEqual([base])
  })

  it('a drive that does not exist is one problem: nowhere to write', async () => {
    const check = await validateInstallPath('Q:\\Hyped Games\\ToS Classic', 1, deps())
    expect(check.problems).toEqual(['not-writable'])
    expect(check.freeBytes).toBeNull()
  })

  it('rejects a drive without room for the Build plus margin, keeping the numbers for the message', async () => {
    const check = await validateInstallPath(join(base, 'ToS'), 50_000_000, deps({ freeBytes: async () => 10_000_000 }))
    expect(check.problems).toEqual(['not-enough-space'])
    expect(check.freeBytes).toBe(10_000_000)
    expect(check.requiredBytes).toBe(50_000_000 + DISK_SPACE_MARGIN_BYTES)
  })

  it('cannot judge space without a Current Manifest: required is null and the path is not ok', async () => {
    const check = await validateInstallPath(join(base, 'ToS'), null, deps())
    expect(check.requiredBytes).toBeNull()
    expect(check.ok).toBe(false)
    expect(check.problems).toEqual(['no-manifest'])
  })

  it('reports a partial install when the folder holds an unfinished Install Record', async () => {
    const target = join(base, 'ToS')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, INSTALL_RECORD_FILE), JSON.stringify(emptyInstallRecord(3)))
    const check = await validateInstallPath(target, 1, deps())
    expect(check.ok).toBe(true)
    expect(check.existing).toBe('partial')
  })

  it('reports a located client executable as a partial install too', async () => {
    const target = join(base, 'ToS')
    await mkdir(join(target, 'release'), { recursive: true })
    await writeFile(join(target, 'release', 'Yuka.exe'), 'MZ')
    expect((await validateInstallPath(target, 1, deps())).existing).toBe('partial')
  })

  it('reports a complete Install Record as an existing install', async () => {
    const target = join(base, 'ToS')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, INSTALL_RECORD_FILE), JSON.stringify({ ...emptyInstallRecord(3), completed: true }))
    expect((await validateInstallPath(target, 1, deps())).existing).toBe('complete')
  })

  it('lists every problem at once so the panel can explain all of them', async () => {
    const check = await validateInstallPath(
      'C:\\Windows\\ToS',
      50_000_000,
      deps({ freeBytes: async () => 10_000_000, probeWritable: async () => false }),
    )
    expect(check.problems).toEqual(['forbidden', 'not-writable', 'not-enough-space'])
  })
})
