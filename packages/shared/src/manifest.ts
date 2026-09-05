import { z } from 'zod'

/**
 * Anchored: only ever matches real ToS patch archives — never `.part` temp
 * files, stray `.lnk`s, or addon ipfs. The capture group is the revision.
 */
export const PATCH_FILE_RE = /^(\d+)_001001\.ipf$/

export const MANIFEST_SCHEMA_VERSION = 2
export const NEWS_SCHEMA_VERSION = 1

/** Returns the revision encoded in a patch filename, or null if it is not a patch file. */
export function parsePatchFileName(name: string): number | null {
  const m = PATCH_FILE_RE.exec(name)
  if (!m) return null
  const rev = Number(m[1])
  return Number.isSafeInteger(rev) ? rev : null
}

export function patchFileName(revision: number): string {
  return `${revision}_001001.ipf`
}

/** Game-relative directory the client loads patch archives from. */
export const PATCH_DIR = 'patch'

/**
 * A Patch archive is a manifest entry directly under `patch/` whose name
 * encodes a revision. Anything else (nested, addons, other ipfs) is an
 * ordinary Managed File. The directory is matched case-insensitively
 * because the game folder lives on NTFS and keeps whatever case it was
 * unpacked with.
 */
export function patchArchiveRevision(path: string): number | null {
  const prefix = `${PATCH_DIR}/`
  if (path.slice(0, prefix.length).toLowerCase() !== prefix) return null
  const name = path.slice(prefix.length)
  if (name.includes('/')) return null
  return parsePatchFileName(name)
}

/** Highest Patch archive revision among the entries, or 0 when there are none. */
export function deriveRevision(files: readonly Pick<ManifestFile, 'path'>[]): number {
  let top = 0
  for (const f of files) {
    const rev = patchArchiveRevision(f.path)
    if (rev !== null && rev > top) top = rev
  }
  return top
}

/**
 * Game-relative path: forward slashes, non-empty segments, no `.`/`..`
 * segments, no leading slash, no drive letter, no backslashes.
 */
export function isGameRelativePath(path: string): boolean {
  if (!path || path.includes('\\') || path.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(path)) return false
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

export const gameRelativePathSchema = z
  .string()
  .refine(isGameRelativePath, 'must be a game-relative path with forward slashes and no `..`')

export const fileClassSchema = z.enum(['managed', 'seed-once'])

export const manifestFileSchema = z.object({
  path: gameRelativePathSchema,
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256'),
  class: fileClassSchema,
})

/** Sort order for manifest entries: plain code-unit comparison of the path. */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    build: z.number().int().positive(),
    label: z.string().min(1).optional(),
    generatedAt: z.string(),
    minLauncherVersion: z.string(),
    blobBaseUrl: z.string().url(),
    newsUrl: z.string().url(),
    revision: z.number().int().nonnegative(),
    files: z.array(manifestFileSchema),
  })
  .superRefine((m, ctx) => {
    for (let i = 1; i < m.files.length; i++) {
      if (comparePaths(m.files[i]!.path, m.files[i - 1]!.path) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'files must be sorted ascending by path, without duplicates',
        })
        return
      }
    }
    const derived = deriveRevision(m.files)
    if (m.revision !== derived) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `revision ${m.revision} must equal the highest patch archive revision ${derived}`,
      })
    }
  })

export type FileClass = z.infer<typeof fileClassSchema>
export type ManifestFile = z.infer<typeof manifestFileSchema>
export type Manifest = z.infer<typeof manifestSchema>

/** lang tag ('pt-BR', 'en', …) → text */
export const localizedTextSchema = z.record(z.string(), z.string().min(1))

export const newsItemSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  pinned: z.boolean().optional().default(false),
  title: localizedTextSchema,
  body: localizedTextSchema,
  url: z.string().url().optional(),
  image: z.string().url().optional(),
})

export const newsFeedSchema = z.object({
  schemaVersion: z.literal(NEWS_SCHEMA_VERSION),
  items: z.array(newsItemSchema).max(50),
})

export type NewsItem = z.infer<typeof newsItemSchema>
export type NewsFeed = z.infer<typeof newsFeedSchema>
