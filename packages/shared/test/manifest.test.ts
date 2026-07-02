import { describe, expect, it } from 'vitest'
import {
  GRANDFATHER_REVISION as GF,
  manifestSchema,
  newsFeedSchema,
  parsePatchFileName,
  patchFileName,
  PATCH_FILE_RE,
} from '../src/index'

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    minLauncherVersion: '1.0.0',
    revision: GF + 2,
    baseUrl: 'https://patch.example.com/patches/',
    newsUrl: 'https://patch.example.com/news/news.json',
    files: [
      { name: patchFileName(GF + 1), revision: GF + 1, size: 100, sha256: 'a'.repeat(64) },
      { name: patchFileName(GF + 2), revision: GF + 2, size: 200, sha256: 'b'.repeat(64) },
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

describe('manifestSchema', () => {
  it('accepts a valid manifest', () => {
    expect(manifestSchema.safeParse(validManifest()).success).toBe(true)
  })

  it('accepts an empty file list with any base revision', () => {
    expect(manifestSchema.safeParse(validManifest({ files: [], revision: GF })).success).toBe(true)
  })

  it('rejects a file whose name does not encode its revision', () => {
    const m = validManifest({
      files: [{ name: patchFileName(GF + 1), revision: GF + 2, size: 100, sha256: 'a'.repeat(64) }],
      revision: GF + 2,
    })
    expect(manifestSchema.safeParse(m).success).toBe(false)
  })

  it('rejects unsorted or duplicate revisions', () => {
    const [a, b] = validManifest().files as [unknown, unknown]
    expect(manifestSchema.safeParse(validManifest({ files: [b, a] })).success).toBe(false)
    expect(manifestSchema.safeParse(validManifest({ files: [a, a], revision: GF + 1 })).success).toBe(false)
  })

  it('rejects a top-level revision that is not the highest file revision', () => {
    expect(manifestSchema.safeParse(validManifest({ revision: GF + 1 })).success).toBe(false)
  })

  it('rejects malformed hashes', () => {
    const m = validManifest({
      files: [{ name: patchFileName(GF + 1), revision: GF + 1, size: 100, sha256: 'ZZ'.repeat(32) }],
      revision: GF + 1,
    })
    expect(manifestSchema.safeParse(m).success).toBe(false)
  })
})

describe('newsFeedSchema', () => {
  it('accepts a valid feed and defaults pinned to false', () => {
    const parsed = newsFeedSchema.parse({
      schemaVersion: 1,
      items: [
        {
          id: 'x',
          date: '2026-07-01',
          title: { 'pt-BR': 'Olá', en: 'Hello' },
          body: { 'pt-BR': 'corpo', en: 'body' },
        },
      ],
    })
    expect(parsed.items[0]!.pinned).toBe(false)
  })

  it('rejects bad dates', () => {
    const feed = {
      schemaVersion: 1,
      items: [{ id: 'x', date: '01/07/2026', title: { en: 't' }, body: { en: 'b' } }],
    }
    expect(newsFeedSchema.safeParse(feed).success).toBe(false)
  })
})
