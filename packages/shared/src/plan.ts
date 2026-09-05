import { parsePatchFileName } from './manifest'

/**
 * Highest revision that ships with the base client install. The patch-only
 * plan below ignores archives at or below this line. Superseded by the
 * Install Record plan (issue #4); kept only until that lands.
 */
export const GRANDFATHER_REVISION = 234929

/** A patch archive as the patch-only plan sees it (name + revision + size + hash). */
export interface PatchEntry {
  name: string
  revision: number
  size: number
  sha256: string
}

/** A pattern-matched file found in the local patch\ directory. */
export interface LocalPatchFile {
  name: string
  size: number
}

export interface UpdatePlan {
  /** Patch entries to fetch, ascending by revision. */
  toDownload: PatchEntry[]
  /** Local file names to delete (managed files absent from the manifest — rollback). */
  toDelete: string[]
  /** What release.revision.txt must say when the plan is fully applied. */
  targetRevision: number
  totalBytes: number
  /** Effective local revision (from the revision file, or derived from local files). */
  localRevision: number
}

export interface ComputePlanArgs {
  /** Patch archives of the Current Manifest, ascending by revision, plus its revision. */
  manifest: { files: PatchEntry[]; revision: number }
  /** Pattern-matched local files (any revision; grandfathered ones are ignored here). */
  localFiles: LocalPatchFile[]
  /** Parsed release.revision.txt, or null when missing/garbage. */
  localRevision: number | null
  /** Deep/repair mode: names whose content hash failed verification. */
  corruptNames?: ReadonlySet<string>
  grandfatherRevision?: number
}

/**
 * The pure core of the patcher. The manifest is authoritative for every
 * local file matching PATCH_FILE_RE with revision > grandfatherRevision:
 * missing or invalid → download, present but not listed → delete (rollback).
 * A local file is valid when it exists with the manifest's size and is not
 * reported corrupt — size is trustworthy because files are only ever
 * renamed into place after their streaming hash passed.
 */
export function computePlan(args: ComputePlanArgs): UpdatePlan {
  const gf = args.grandfatherRevision ?? GRANDFATHER_REVISION
  const corrupt = args.corruptNames ?? new Set<string>()

  const managedLocal = new Map<string, LocalPatchFile>()
  for (const f of args.localFiles) {
    const rev = parsePatchFileName(f.name)
    if (rev !== null && rev > gf) managedLocal.set(f.name, f)
  }

  const manifestNames = new Set(args.manifest.files.map((f) => f.name))

  const toDelete = [...managedLocal.keys()]
    .filter((name) => !manifestNames.has(name))
    .sort((a, b) => parsePatchFileName(b)! - parsePatchFileName(a)!)

  const toDownload = args.manifest.files.filter((entry) => {
    const local = managedLocal.get(entry.name)
    if (!local) return true
    if (local.size !== entry.size) return true
    if (corrupt.has(entry.name)) return true
    return false
  })

  let localRevision = args.localRevision
  if (localRevision === null) {
    localRevision = gf
    for (const entry of args.manifest.files) {
      const local = managedLocal.get(entry.name)
      if (local && local.size === entry.size && !corrupt.has(entry.name) && entry.revision > localRevision) {
        localRevision = entry.revision
      }
    }
  }

  return {
    toDownload,
    toDelete,
    targetRevision: args.manifest.revision,
    totalBytes: toDownload.reduce((sum, f) => sum + f.size, 0),
    localRevision,
  }
}
