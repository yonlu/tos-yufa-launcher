import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DXVK_FILE, DXVK_SHA256, INSTALL_RECORD_FILE, type InstallRecord } from '../packages/shared/src/index'
import { expectCompatibilityFix, expectReleaseMatchesRecord } from './e2e-checks'

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

let gameDir: string

async function put(rel: string, content: Buffer | string): Promise<void> {
  const abs = join(gameDir, ...rel.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

/** A completed Install Record for `files`, hashed from what was written. */
async function record(files: Record<string, Buffer>): Promise<void> {
  const rec: InstallRecord = {
    schemaVersion: 1,
    build: 1,
    completed: true,
    files: Object.entries(files).map(([path, content]) => ({ path, size: content.length, mtimeMs: 0, sha256: sha256(content) })),
    seeded: [],
  }
  await put(INSTALL_RECORD_FILE, JSON.stringify(rec))
}

beforeEach(async () => {
  gameDir = join(await mkdtemp(join(tmpdir(), 'yufa-e2e-checks-')), 'game')
})

describe('expectReleaseMatchesRecord', () => {
  const exe = Buffer.from('client')
  const dll = randomBytes(64)

  it('passes when release/ holds the recorded files byte for byte plus the launcher-owned revision file', async () => {
    await put('release/Yuka.exe', exe)
    await put('release/a.dll', dll)
    await put('release/release.revision.txt', '1116002')
    await put('patch/x.ipf', 'archive')
    await record({ 'release/Yuka.exe': exe, 'release/a.dll': dll, 'patch/x.ipf': Buffer.from('archive') })
    await expect(expectReleaseMatchesRecord(gameDir)).resolves.toBeUndefined()
  })

  it('fails on a file the record does not know, naming it', async () => {
    await put('release/Yuka.exe', exe)
    await put(`release/${DXVK_FILE}`, randomBytes(64))
    await record({ 'release/Yuka.exe': exe })
    await expect(expectReleaseMatchesRecord(gameDir)).rejects.toThrow(`release/${DXVK_FILE}`)
  })

  it('fails on a recorded file whose bytes differ or which is missing', async () => {
    await put('release/Yuka.exe', exe)
    await put('release/a.dll', randomBytes(64))
    await record({ 'release/Yuka.exe': exe, 'release/a.dll': dll })
    await expect(expectReleaseMatchesRecord(gameDir)).rejects.toThrow('release/a.dll')

    await put('release/a.dll', dll)
    await record({ 'release/Yuka.exe': exe, 'release/a.dll': dll, 'release/sub/b.dll': dll })
    await expect(expectReleaseMatchesRecord(gameDir)).rejects.toThrow('release/sub/b.dll')
  })

  it('looks into subfolders of release/', async () => {
    await put('release/Yuka.exe', exe)
    await put('release/sub/stray.txt', 'x')
    await record({ 'release/Yuka.exe': exe })
    await expect(expectReleaseMatchesRecord(gameDir)).rejects.toThrow('release/sub/stray.txt')
  })
})

describe('expectCompatibilityFix', () => {
  it('present: the file must carry the pinned hash', async () => {
    await put(`release/${DXVK_FILE}`, randomBytes(64))
    await expect(expectCompatibilityFix(gameDir, 'present')).rejects.toThrow(DXVK_SHA256)
    await expect(expectCompatibilityFix(gameDir, 'absent')).rejects.toThrow(DXVK_FILE)
  })

  it('absent: no file at all', async () => {
    await mkdir(join(gameDir, 'release'), { recursive: true })
    await expect(expectCompatibilityFix(gameDir, 'absent')).resolves.toBeUndefined()
    await expect(expectCompatibilityFix(gameDir, 'present')).rejects.toThrow(DXVK_FILE)
  })
})
