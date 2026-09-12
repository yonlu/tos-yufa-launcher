import { describe, expect, it } from 'vitest'
import {
  deriveRevision,
  manifestSchema,
  parsePatchFileName,
  patchArchiveRevision,
  patchFileName,
  PATCH_FILE_RE,
  type ManifestFile,
} from '../src/index'

function file(path: string, over: Partial<ManifestFile> = {}): ManifestFile {
  return { path, size: 100, sha256: 'a'.repeat(64), class: 'managed', ...over }
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    build: 3,
    label: '1.0',
    generatedAt: '2026-09-05T12:00:00.000Z',
    minLauncherVersion: '1.0.0',
    blobBaseUrl: 'https://patch.example.com/objects/',
    revision: 1121001,
    files: [
      file('data/bg_hi.ipf'),
      file('patch/1116001_001001.ipf'),
      file('patch/1121001_001001.ipf'),
      file('release/Yuka.exe'),
      file('release/uilayout.xml', { class: 'seed-once' }),
    ],
    ...overrides,
  }
}

describe('PATCH_FILE_RE / parsePatchFileName', () => {
  it('matches real patch names and extracts the revision', () => {
    expect(parsePatchFileName('234929_001001.ipf')).toBe(234929)
  })

  it('rejects everything else', () => {
    for (const name of [
      '234929_001001.ipf.part',
      'Yuka.exe - Atalho.lnk',
      '_betterquest.ipf',
      '234929_001002.ipf',
      'x234929_001001.ipf',
      '234929_001001.IPF',
    ]) {
      expect(PATCH_FILE_RE.test(name), name).toBe(false)
    }
  })
})

describe('patchArchiveRevision / deriveRevision', () => {
  it('only entries directly under patch/ count as patch archives', () => {
    expect(patchArchiveRevision('patch/1116001_001001.ipf')).toBe(1116001)
    expect(patchArchiveRevision('Patch/1116001_001001.ipf')).toBe(1116001)
    expect(patchArchiveRevision('1116001_001001.ipf')).toBeNull()
    expect(patchArchiveRevision('addons/patch/1116001_001001.ipf')).toBeNull()
    expect(patchArchiveRevision('patch/sub/1116001_001001.ipf')).toBeNull()
    expect(patchArchiveRevision('patch/_betterquest.ipf')).toBeNull()
  })

  it('derives the highest archive revision, 0 when there are none', () => {
    expect(deriveRevision(validManifest().files as ManifestFile[])).toBe(1121001)
    expect(deriveRevision([file('data/x.ipf'), file('release/Yuka.exe')])).toBe(0)
  })
})

describe('manifestSchema (version 2)', () => {
  it('accepts a valid manifest', () => {
    expect(manifestSchema.safeParse(validManifest()).success).toBe(true)
  })

  it('accepts a manifest without a label and without patch archives at revision 0', () => {
    const m = validManifest({ label: undefined, revision: 0, files: [file('release/Yuka.exe')] })
    expect(manifestSchema.safeParse(m).success).toBe(true)
  })

  it('rejects the old schema version', () => {
    expect(manifestSchema.safeParse(validManifest({ schemaVersion: 1 })).success).toBe(false)
  })

  it('rejects absolute paths, parent traversal, drive letters and backslashes', () => {
    for (const path of ['/release/Yuka.exe', 'release/../user.xml', '..', 'C:/release/Yuka.exe', 'release\\Yuka.exe', 'release//x', 'release/']) {
      const m = validManifest({ files: [file(path)], revision: 0 })
      expect(manifestSchema.safeParse(m).success, path).toBe(false)
    }
  })

  it('rejects unsorted or duplicate paths', () => {
    const a = file('data/a.ipf')
    const b = file('data/b.ipf')
    expect(manifestSchema.safeParse(validManifest({ files: [b, a], revision: 0 })).success).toBe(false)
    expect(manifestSchema.safeParse(validManifest({ files: [a, a], revision: 0 })).success).toBe(false)
  })

  it('rejects a revision that is not the highest patch archive revision', () => {
    expect(manifestSchema.safeParse(validManifest({ revision: 1116001 })).success).toBe(false)
    expect(manifestSchema.safeParse(validManifest({ files: [file('release/Yuka.exe')], revision: 5 })).success).toBe(false)
  })

  it('rejects unknown file classes and malformed hashes', () => {
    expect(
      manifestSchema.safeParse(validManifest({ files: [file('a', { class: 'player' as never })], revision: 0 })).success,
    ).toBe(false)
    expect(
      manifestSchema.safeParse(validManifest({ files: [file('a', { sha256: 'ZZ'.repeat(32) })], revision: 0 })).success,
    ).toBe(false)
  })

  it('rejects a non-positive build', () => {
    expect(manifestSchema.safeParse(validManifest({ build: 0 })).success).toBe(false)
  })
})
