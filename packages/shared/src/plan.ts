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

/**
 * Managed Files at or below this size are re-hashed on every check (cheap:
 * exes, dlls, scripts, xml — where tampering and antivirus damage land).
 * Larger ones are trusted from the Install Record and re-hashed only by
 * Repair.
 */
export const HASH_ON_CHECK_MAX_BYTES = 16 * 1024 * 1024

export interface FilesToHashArgs {
  manifest: Pick<Manifest, 'files'>
  record: InstallRecord | null
  local: ReadonlyMap<string, LocalFileStat>
  /** `check`: the every-start verification; `repair`: deep verification of every Managed File. */
  mode: 'check' | 'repair'
}

/**
 * The Managed Files whose content must be hashed before `computePlan` can
 * judge them, in manifest order. Only files present with the manifest's
 * size qualify: any other file is downloaded regardless, so hashing it
 * would be wasted work. On a check that is every file at or below
 * `HASH_ON_CHECK_MAX_BYTES`, plus files of any size the record does not
 * know (a crash between a file's rename and the record write leaves such a
 * file; hashing it is far cheaper than fetching it again). Repair hashes
 * them all. Seed-once Files are never hashed.
 */
export function filesToHash(args: FilesToHashArgs): ManifestFile[] {
  const recorded = new Set((args.record?.files ?? []).map((f) => f.path))
  return args.manifest.files.filter((f) => {
    if (f.class !== 'managed' || args.local.get(f.path)?.size !== f.size) return false
    return args.mode === 'repair' || f.size <= HASH_ON_CHECK_MAX_BYTES || !recorded.has(f.path)
  })
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
 * Files; the Install Record is the only source of deletions; a Seed-once
 * File is written once — when absent and never seeded before — and from
 * then on neither verified, overwritten nor deleted, whatever the game or
 * the manifest do to it.
 *
 * A recorded Managed File is trusted when its local size and mtime still
 * match the record and the record's hash matches the manifest. `hashed`
 * overrides that in both directions (see `filesToHash` for what to hash).
 */
export function computePlan(args: ComputePlanArgs): InstallPlan {
  const recorded = new Map((args.record?.files ?? []).map((f) => [f.path, f]))
  const seeded = new Set(args.record?.seeded ?? [])
  const hashed = args.hashed ?? new Map<string, string>()

  const download: ManifestFile[] = []
  const seed: ManifestFile[] = []
  for (const entry of args.manifest.files) {
    const local = args.local.get(entry.path)
    if (entry.class === 'seed-once') {
      if (!local && !seeded.has(entry.path)) seed.push(entry)
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
