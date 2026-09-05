import { comparePaths, patchArchiveRevision, type Manifest, type ManifestFile } from './manifest'
import type { InstallRecord } from './record'

/** What a local stat says about a file that exists in the game folder. */
export interface LocalFileStat {
  size: number
  mtimeMs: number
}

export interface ComputePlanArgs {
  manifest: Pick<Manifest, 'revision' | 'files'>
  /** The folder's Install Record, or null when there is none. */
  record: InstallRecord | null
  /** Files that exist locally, keyed by game-relative path. Must cover every recorded and every manifest path. */
  local: ReadonlyMap<string, LocalFileStat>
  /**
   * Actual content hashes of local files, keyed by path, for whatever the
   * caller chose to hash (Repair hashes every Managed File). Authoritative
   * for the paths it covers: a hash that matches the manifest trusts the
   * file even without a record; one that differs forces a download even
   * with one.
   */
  hashed?: ReadonlyMap<string, string>
}

export interface InstallPlan {
  /** Managed Files to fetch, in download order. */
  toDownload: ManifestFile[]
  /** Seed-once Files absent locally, to fetch and write once, in download order. */
  toSeed: ManifestFile[]
  /** Recorded paths the manifest no longer lists; nothing else is ever deleted. */
  toDelete: string[]
  /** What release.revision.txt must say when the plan is fully applied. */
  targetRevision: number
  /** Bytes of toDownload plus toSeed. */
  totalBytes: number
}

/**
 * Download order: smallest first (fast time-to-first-progress; exes and
 * dlls land early), with Patch archives ascending by revision among
 * themselves so the revision file can advance as they land.
 */
export function orderDownloads(files: readonly ManifestFile[]): ManifestFile[] {
  const bySize = [...files].sort((a, b) => a.size - b.size || comparePaths(a.path, b.path))
  const archives = bySize
    .filter((f) => patchArchiveRevision(f.path) !== null)
    .sort((a, b) => patchArchiveRevision(a.path)! - patchArchiveRevision(b.path)!)
  let next = 0
  return bySize.map((f) => (patchArchiveRevision(f.path) === null ? f : archives[next++]!))
}

/**
 * The pure core of the patcher. The manifest is authoritative for Managed
 * Files; the Install Record is the only source of deletions; Seed-once
 * Files are written when absent and otherwise ignored.
 *
 * A recorded Managed File is trusted when its local size and mtime still
 * match the record and the record's hash matches the manifest. `hashed`
 * overrides that in both directions.
 */
export function computePlan(args: ComputePlanArgs): InstallPlan {
  const recorded = new Map((args.record?.files ?? []).map((f) => [f.path, f]))
  const hashed = args.hashed ?? new Map<string, string>()

  const download: ManifestFile[] = []
  const seed: ManifestFile[] = []
  for (const entry of args.manifest.files) {
    const local = args.local.get(entry.path)
    if (entry.class === 'seed-once') {
      if (!local) seed.push(entry)
      continue
    }
    const actual = hashed.get(entry.path)
    if (actual !== undefined) {
      if (actual !== entry.sha256) download.push(entry)
      continue
    }
    const rec = recorded.get(entry.path)
    const trusted =
      !!local && !!rec && rec.sha256 === entry.sha256 && rec.size === local.size && rec.mtimeMs === local.mtimeMs
    if (!trusted) download.push(entry)
  }

  const manifestPaths = new Set(args.manifest.files.map((f) => f.path))
  const toDelete = [...recorded.keys()].filter((p) => !manifestPaths.has(p)).sort(comparePaths)

  const toDownload = orderDownloads(download)
  const toSeed = orderDownloads(seed)
  return {
    toDownload,
    toSeed,
    toDelete,
    targetRevision: args.manifest.revision,
    totalBytes: [...toDownload, ...toSeed].reduce((s, f) => s + f.size, 0),
  }
}
