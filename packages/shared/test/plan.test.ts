import { describe, expect, it } from 'vitest'
import {
  computePlan,
  GRANDFATHER_REVISION as GF,
  patchFileName,
  type LocalPatchFile,
  type PatchEntry,
} from '../src/index'

function entry(revision: number, size = 1000): PatchEntry {
  return { name: patchFileName(revision), revision, size, sha256: 'a'.repeat(64) }
}

function local(revision: number, size = 1000): LocalPatchFile {
  return { name: patchFileName(revision), size }
}

const A = entry(GF + 1)
const B = entry(GF + 2, 2000)
const C = entry(GF + 3, 3000)

describe('computePlan', () => {
  it('fresh install: downloads everything ascending, derives local revision as grandfather', () => {
    const plan = computePlan({
      manifest: { files: [A, B, C], revision: C.revision },
      localFiles: [],
      localRevision: null,
    })
    expect(plan.toDownload).toEqual([A, B, C])
    expect(plan.toDelete).toEqual([])
    expect(plan.targetRevision).toBe(C.revision)
    expect(plan.totalBytes).toBe(6000)
    expect(plan.localRevision).toBe(GF)
  })

  it('incremental: only entries not locally valid are downloaded', () => {
    const plan = computePlan({
      manifest: { files: [A, B, C], revision: C.revision },
      localFiles: [local(A.revision)],
      localRevision: A.revision,
    })
    expect(plan.toDownload).toEqual([B, C])
    expect(plan.toDelete).toEqual([])
    expect(plan.totalBytes).toBe(5000)
  })

  it('heals a missing older entry even when the revision file claims it was applied', () => {
    const plan = computePlan({
      manifest: { files: [A, B, C], revision: C.revision },
      localFiles: [local(C.revision, 3000)],
      localRevision: C.revision,
    })
    expect(plan.toDownload).toEqual([A, B])
  })

  it('size mismatch forces redownload', () => {
    const plan = computePlan({
      manifest: { files: [A], revision: A.revision },
      localFiles: [local(A.revision, 999)],
      localRevision: A.revision,
    })
    expect(plan.toDownload).toEqual([A])
  })

  it('deep mode: corrupt names force redownload despite matching size', () => {
    const plan = computePlan({
      manifest: { files: [A, B], revision: B.revision },
      localFiles: [local(A.revision), local(B.revision, 2000)],
      localRevision: B.revision,
      corruptNames: new Set([A.name]),
    })
    expect(plan.toDownload).toEqual([A])
  })

  it('rollback: managed local files absent from the manifest are deleted, revision goes down', () => {
    const D = local(GF + 5)
    const plan = computePlan({
      manifest: { files: [A], revision: A.revision },
      localFiles: [local(A.revision), D],
      localRevision: GF + 5,
    })
    expect(plan.toDownload).toEqual([])
    expect(plan.toDelete).toEqual([D.name])
    expect(plan.targetRevision).toBe(A.revision)
  })

  it('deletes are ordered by revision descending', () => {
    const plan = computePlan({
      manifest: { files: [], revision: GF },
      localFiles: [local(GF + 1), local(GF + 3), local(GF + 2)],
      localRevision: GF + 3,
    })
    expect(plan.toDelete).toEqual([patchFileName(GF + 3), patchFileName(GF + 2), patchFileName(GF + 1)])
    expect(plan.targetRevision).toBe(GF)
  })

  it('never touches grandfathered base-install files', () => {
    const plan = computePlan({
      manifest: { files: [A], revision: A.revision },
      localFiles: [local(11072), local(GF), local(A.revision)],
      localRevision: A.revision,
    })
    expect(plan.toDownload).toEqual([])
    expect(plan.toDelete).toEqual([])
  })

  it('derives local revision from the highest size-valid managed file when the revision file is unreadable', () => {
    const plan = computePlan({
      manifest: { files: [A, B, C], revision: C.revision },
      localFiles: [local(A.revision), local(B.revision, 42)],
      localRevision: null,
    })
    expect(plan.localRevision).toBe(A.revision)
    expect(plan.toDownload).toEqual([B, C])
  })

  it('a local file not present in the manifest never counts toward the derived revision', () => {
    const plan = computePlan({
      manifest: { files: [A], revision: A.revision },
      localFiles: [local(GF + 9)],
      localRevision: null,
    })
    expect(plan.localRevision).toBe(GF)
    expect(plan.toDelete).toEqual([patchFileName(GF + 9)])
    expect(plan.toDownload).toEqual([A])
  })

  it('passes a non-null local revision through untouched', () => {
    const plan = computePlan({
      manifest: { files: [A], revision: A.revision },
      localFiles: [],
      localRevision: 123,
    })
    expect(plan.localRevision).toBe(123)
  })

  it('respects a custom grandfather revision', () => {
    const plan = computePlan({
      manifest: { files: [], revision: 10 },
      localFiles: [local(11), local(9)],
      localRevision: null,
      grandfatherRevision: 10,
    })
    expect(plan.toDelete).toEqual([patchFileName(11)])
  })
})
