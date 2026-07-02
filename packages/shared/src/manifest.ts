import { z } from 'zod'

/**
 * Anchored: only ever matches real ToS patch archives — never `.part` temp
 * files, stray `.lnk`s, or addon ipfs. The capture group is the revision.
 */
export const PATCH_FILE_RE = /^(\d+)_001001\.ipf$/

/**
 * Highest revision that ships with the base client install (the 144 ipfs
 * players get with the initial download). The manifest only manages
 * revisions ABOVE this line; files at or below it are never touched.
 */
export const GRANDFATHER_REVISION = 234929

export const MANIFEST_SCHEMA_VERSION = 1
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

export const manifestFileSchema = z
  .object({
    name: z.string().regex(PATCH_FILE_RE, 'must look like <revision>_001001.ipf'),
    revision: z.number().int().positive(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256'),
  })
  .superRefine((f, ctx) => {
    if (parsePatchFileName(f.name) !== f.revision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `revision ${f.revision} does not match filename ${f.name}`,
      })
    }
  })

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    generatedAt: z.string().optional(),
    minLauncherVersion: z.string(),
    revision: z.number().int().nonnegative(),
    baseUrl: z.string().url(),
    newsUrl: z.string().url(),
    files: z.array(manifestFileSchema),
  })
  .superRefine((m, ctx) => {
    for (let i = 1; i < m.files.length; i++) {
      if (m.files[i]!.revision <= m.files[i - 1]!.revision) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'files must be sorted ascending by revision, without duplicates',
        })
        return
      }
    }
    const last = m.files[m.files.length - 1]
    if (last && m.revision !== last.revision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `top-level revision ${m.revision} must equal the highest file revision ${last.revision}`,
      })
    }
  })

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
