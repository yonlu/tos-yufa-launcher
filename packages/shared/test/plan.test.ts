import { describe, expect, it } from 'vitest'
import {
  computePlan,
  emptyInstallRecord,
  filesToHash,
  HASH_ON_CHECK_MAX_BYTES,
  orderDownloads,
  patchFileName,
  type InstallRecord,
  type LocalFileStat,
  type ManifestFile,
} from '../src/index'

function hash(seed: string): string {
  return seed.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)
}

function managed(path: string, size: number, seed = path): ManifestFile {
  return { path, size, sha256: hash(seed), class: 'managed' }
}

function seedOnce(path: string, size: number): ManifestFile {
  return { path, size, sha256: hash(path), class: 'seed-once' }
}

function archive(revision: number, size: number): ManifestFile {
  return managed(`patch/${patchFileName(revision)}`, size, `p${revision}`)
}

const EXE = managed('release/Yuka.exe', 100)
const DLL = managed('release/a.dll', 50)
const BG = managed('data/bg.ipf', 9000)
const LAYOUT = seedOnce('release/uilayout.xml', 20)
const P1 = archive(1116001, 500)
const P2 = archive(1116002, 300)

const files = [BG, P1, P2, DLL, EXE, LAYOUT].sort((a, b) => (a.path < b.path ? -1 : 1))
const manifest = { revision: 1116002, files }

function recordOf(entries: ManifestFile[], over: Partial<InstallRecord> = {}): InstallRecord {
  return {
    ...emptyInstallRecord(2),
    files: entries.map((f) => ({ path: f.path, size: f.size, mtimeMs: 1000, sha256: f.sha256 })),
    ...over,
  }
}

function localOf(entries: ManifestFile[], mtimeMs = 1000): Map<string, LocalFileStat> {
  return new Map(entries.map((f) => [f.path, { size: f.size, mtimeMs }]))
}

describe('orderDownloads', () => {
  it('smallest first, patch archives ascending by revision among themselves', () => {
    const late = archive(1116003, 10) // tiny but newest: must not jump ahead of older archives
    const order = orderDownloads([BG, P2, late, EXE, P1, DLL]).map((f) => f.path)
    expect(order).toEqual([P1.path, DLL.path, EXE.path, P2.path, late.path, BG.path])
  })

  it('ties on size break by path so the order is stable', () => {
    const a = managed('b.bin', 5)
    const b = managed('a.bin', 5)
    expect(orderDownloads([a, b]).map((f) => f.path)).toEqual(['a.bin', 'b.bin'])
  })
})

describe('computePlan', () => {
  it('empty folder without a record: downloads every Managed File, seeds every Seed-once File', () => {
    const plan = computePlan({ manifest, record: null, local: new Map() })
    expect(plan.toDownload.map((f) => f.path)).toEqual([DLL.path, EXE.path, P1.path, P2.path, BG.path])
    expect(plan.toSeed).toEqual([LAYOUT])
    expect(plan.toDelete).toEqual([])
    expect(plan.toRecord).toEqual([])
    expect(plan.targetRevision).toBe(1116002)
    expect(plan.totalBytes).toBe(100 + 50 + 9000 + 20 + 500 + 300)
  })

  it('resume: recorded files whose size and mtime still match are not downloaded again', () => {
    const done = [EXE, DLL, P1]
    const plan = computePlan({ manifest, record: recordOf(done), local: localOf([...done, LAYOUT]) })
    expect(plan.toDownload.map((f) => f.path)).toEqual([P2.path, BG.path])
    expect(plan.toSeed).toEqual([])
    expect(plan.totalBytes).toBe(9300)
  })

  it('a recorded file that is missing, resized or touched locally is downloaded again', () => {
    const record = recordOf([EXE, DLL, BG])
    const local = localOf([DLL, BG])
    local.set(DLL.path, { size: DLL.size, mtimeMs: 2000 })
    local.set(BG.path, { size: 1, mtimeMs: 1000 })
    const plan = computePlan({ manifest, record, local })
    expect(plan.toDownload.map((f) => f.path)).toEqual(expect.arrayContaining([EXE.path, DLL.path, BG.path]))
  })

  it('a recorded file whose hash differs from the manifest (new Build) is downloaded', () => {
    const oldExe = { ...EXE, sha256: hash('old') }
    const plan = computePlan({ manifest, record: recordOf([oldExe, DLL, BG, P1, P2]), local: localOf([EXE, DLL, BG, P1, P2, LAYOUT]) })
    expect(plan.toDownload).toEqual([EXE])
  })

  it('a file present locally but absent from the record is not trusted', () => {
    const plan = computePlan({ manifest, record: emptyInstallRecord(3), local: localOf([EXE]) })
    expect(plan.toDownload.map((f) => f.path)).toContain(EXE.path)
  })

  it('hash results are authoritative in both directions', () => {
    const plan = computePlan({
      manifest,
      record: recordOf([EXE, DLL, BG, P1, P2]),
      local: localOf([EXE, DLL, BG, P1, P2, LAYOUT]),
      hashed: new Map([
        [EXE.path, hash('corrupt')], // record trusts it, content says otherwise
        [DLL.path, DLL.sha256],
      ]),
    })
    expect(plan.toDownload).toEqual([EXE])
    expect(plan.toRecord).toEqual([])

    const noRecord = computePlan({ manifest, record: null, local: localOf([EXE]), hashed: new Map([[EXE.path, EXE.sha256]]) })
    expect(noRecord.toDownload.map((f) => f.path)).not.toContain(EXE.path)
  })

  it('a file trusted by its hash that the record could not have trusted is reported for recording', () => {
    const record = recordOf([DLL, BG]) // EXE unknown; BG recorded with a stale stat
    const local = localOf([EXE, DLL, BG])
    local.set(BG.path, { size: BG.size, mtimeMs: 2000 })
    const plan = computePlan({
      manifest,
      record,
      local,
      hashed: new Map([
        [EXE.path, EXE.sha256],
        [DLL.path, DLL.sha256], // already trusted by the record: nothing to add
        [BG.path, BG.sha256],
      ]),
    })
    expect(plan.toRecord.map((f) => f.path)).toEqual([BG.path, EXE.path])
    expect(plan.toDownload.map((f) => f.path)).toEqual([P1.path, P2.path])

    const noRecord = computePlan({ manifest, record: null, local: localOf([EXE]), hashed: new Map([[EXE.path, EXE.sha256]]) })
    expect(noRecord.toRecord).toEqual([EXE])
  })

  it('deletes only recorded paths the manifest dropped, sorted by path', () => {
    const gone1 = managed('patch/1116009_001001.ipf', 10)
    const gone2 = managed('data/old.ipf', 10)
    const plan = computePlan({
      manifest,
      record: recordOf([EXE, DLL, BG, P1, P2, gone1, gone2]),
      local: localOf([EXE, DLL, BG, P1, P2, LAYOUT, gone1, gone2]),
    })
    expect(plan.toDownload).toEqual([])
    expect(plan.toDelete).toEqual([gone2.path, gone1.path])
  })

  it('Seed-once Files are written when absent and not yet seeded; present ones are left alone whatever the record says', () => {
    const present = computePlan({
      manifest,
      record: recordOf([], { seeded: [] }),
      local: new Map([[LAYOUT.path, { size: 999, mtimeMs: 5 }]]),
    })
    expect(present.toSeed).toEqual([])
    expect(present.toDownload.map((f) => f.path)).not.toContain(LAYOUT.path)

    const absent = computePlan({ manifest, record: recordOf([], { seeded: [] }), local: new Map() })
    expect(absent.toSeed).toEqual([LAYOUT])
    expect(absent.toDelete).toEqual([])
  })

  it('a seeded Seed-once File is never re-downloaded, verified or deleted, even when absent or hashed as different', () => {
    const seeded = recordOf([], { seeded: [LAYOUT.path] })
    const gone = computePlan({ manifest, record: seeded, local: new Map() })
    expect(gone.toSeed).toEqual([])
    expect(gone.toDelete).toEqual([])

    const changed = computePlan({
      manifest,
      record: seeded,
      local: new Map([[LAYOUT.path, { size: 999, mtimeMs: 5 }]]),
      hashed: new Map([[LAYOUT.path, hash('edited by the game')]]),
    })
    expect(changed.toSeed).toEqual([])
    expect(changed.toDownload.map((f) => f.path)).not.toContain(LAYOUT.path)
    expect(changed.toDelete).toEqual([])
  })

  it('target revision is 0 when the manifest has no patch archives', () => {
    const plan = computePlan({ manifest: { revision: 0, files: [EXE] }, record: null, local: new Map() })
    expect(plan.targetRevision).toBe(0)
  })
})

describe('filesToHash', () => {
  const big = managed('data/huge.ipf', HASH_ON_CHECK_MAX_BYTES + 1)
  const edge = managed('data/edge.ipf', HASH_ON_CHECK_MAX_BYTES)
  const wide = { revision: 1116002, files: [...files, big, edge] }
  const all = [EXE, DLL, BG, P1, P2, big, edge]

  it('check: every Managed File at or below the limit that is present with the manifest size', () => {
    const paths = filesToHash({ manifest: wide, record: recordOf(all), local: localOf([...all, LAYOUT]), mode: 'check' })
    expect(paths.map((f) => f.path).sort()).toEqual([EXE, DLL, BG, P1, P2, edge].map((f) => f.path).sort())
  })

  it('check: a file above the limit is hashed only when the record does not know it', () => {
    const record = recordOf([EXE, DLL, BG, P1, P2, edge]) // big renamed into place, crash before the record write
    const paths = filesToHash({ manifest: wide, record, local: localOf([...all, LAYOUT]), mode: 'check' })
    expect(paths.map((f) => f.path)).toContain(big.path)

    const noRecord = filesToHash({ manifest: wide, record: null, local: localOf(all), mode: 'check' })
    expect(noRecord.map((f) => f.path)).toContain(big.path)
  })

  it('repair: every Managed File present with the manifest size, whatever its size or record', () => {
    const paths = filesToHash({ manifest: wide, record: recordOf(all), local: localOf([...all, LAYOUT]), mode: 'repair' })
    expect(paths.map((f) => f.path).sort()).toEqual(all.map((f) => f.path).sort())
  })

  it('never hashes Seed-once Files, absent files, or files whose size already disagrees with the manifest', () => {
    const local = localOf([EXE, DLL, LAYOUT, big])
    local.set(DLL.path, { size: DLL.size + 1, mtimeMs: 1000 })
    const paths = filesToHash({ manifest: wide, record: null, local, mode: 'repair' })
    expect(paths.map((f) => f.path).sort()).toEqual([EXE.path, big.path].sort())
  })

  it('returns files in manifest order so hashing progress is predictable', () => {
    const paths = filesToHash({ manifest: wide, record: null, local: localOf(all), mode: 'repair' })
    expect(paths.map((f) => f.path)).toEqual(wide.files.filter((f) => f.class === 'managed').map((f) => f.path))
  })
})
