import { z } from 'zod'
import { gameRelativePathSchema } from './manifest'

/**
 * Redistributables (CONTEXT.md): the Windows runtimes the 32-bit client
 * needs. Installed only when detected missing; not part of the game
 * Manifest. Hosted under the bucket's `redist/` area, described by a
 * small index the CLI writes last.
 */
export const REDIST_RUNTIMES = ['vcredist', 'directx'] as const
export type RedistRuntime = (typeof REDIST_RUNTIMES)[number]

export const REDIST_INDEX_SCHEMA_VERSION = 1

/** Key of the index under the redist prefix. */
export const REDIST_INDEX_FILE = 'index.json'

/**
 * Trimmed installer sets, as laid out in the folder `redist push` uploads
 * (paths relative to `redist/`). `entry` is the file the launcher runs.
 * The DirectX set is the June 2010 web of DXSETUP plus only the cab the
 * client needs (d3dx9_43, x86), so a fresh Windows is a few MB away from
 * a starting client instead of ~100 MB.
 */
export const REDIST_LAYOUT: Record<RedistRuntime, { entry: string; required: readonly string[] }> = {
  vcredist: { entry: 'vcredist/vc_redist.x86.exe', required: ['vcredist/vc_redist.x86.exe'] },
  directx: {
    entry: 'directx/DXSETUP.exe',
    required: ['directx/DXSETUP.exe', 'directx/DSETUP.dll', 'directx/dsetup32.dll', 'directx/dxupdate.cab'],
  },
}

/** Pattern the DirectX runtime's payload cab must match (`Jun2010_d3dx9_43_x86.cab`). */
export const DIRECTX_PAYLOAD_CAB_RE = /^directx\/[^/]*d3dx9_43_x86\.cab$/i

export const redistFileSchema = z.object({
  path: gameRelativePathSchema,
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256'),
})

export const redistRuntimeSchema = z.object({
  /** Path (relative to `redist/`) of the installer the launcher executes; must be one of `files`. */
  entry: gameRelativePathSchema,
  files: z.array(redistFileSchema).min(1),
})

export const redistIndexSchema = z
  .object({
    schemaVersion: z.literal(REDIST_INDEX_SCHEMA_VERSION),
    generatedAt: z.string(),
    runtimes: z.object({
      vcredist: redistRuntimeSchema,
      directx: redistRuntimeSchema,
    }),
  })
  .superRefine((index, ctx) => {
    for (const name of REDIST_RUNTIMES) {
      const rt = index.runtimes[name]
      if (!rt.files.some((f) => f.path === rt.entry)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name}: entry ${rt.entry} is not among its files`,
        })
      }
    }
  })

export type RedistFile = z.infer<typeof redistFileSchema>
export type RedistRuntimeSet = z.infer<typeof redistRuntimeSchema>
export type RedistIndex = z.infer<typeof redistIndexSchema>
