import { z } from 'zod'
import { gameRelativePathSchema } from './manifest'

export const INSTALL_RECORD_SCHEMA_VERSION = 1

/** File name of the Install Record inside the game folder (dot-prefixed: hidden by convention). */
export const INSTALL_RECORD_FILE = '.yufa-install.json'

export const installRecordFileSchema = z.object({
  path: gameRelativePathSchema,
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

/**
 * The launcher's local memory of what it installed (CONTEXT.md: Install
 * Record). `build` is the Build the record was last written for; `completed`
 * flips to true only once that Build is fully applied. The launcher deletes
 * nothing that is not listed under `files`.
 */
export const installRecordSchema = z.object({
  schemaVersion: z.literal(INSTALL_RECORD_SCHEMA_VERSION),
  build: z.number().int().positive(),
  completed: z.boolean(),
  /** Every installed Managed File, with the stat the launcher saw right after installing it. */
  files: z.array(installRecordFileSchema),
  /** Seed-once paths the launcher has written at least once. */
  seeded: z.array(gameRelativePathSchema),
})

export type InstallRecordFile = z.infer<typeof installRecordFileSchema>
export type InstallRecord = z.infer<typeof installRecordSchema>

export function emptyInstallRecord(build: number): InstallRecord {
  return { schemaVersion: INSTALL_RECORD_SCHEMA_VERSION, build, completed: false, files: [], seeded: [] }
}

/** The record with `file` installed (replacing any earlier entry for its path). */
export function withInstalledFile(record: InstallRecord, file: InstallRecordFile): InstallRecord {
  return { ...record, files: [...record.files.filter((f) => f.path !== file.path), file] }
}

/** The record with `path` no longer installed. */
export function withoutFile(record: InstallRecord, path: string): InstallRecord {
  return { ...record, files: record.files.filter((f) => f.path !== path) }
}

/** The record noting that `path` has been seeded; unchanged (same object) when it already was. */
export function withSeeded(record: InstallRecord, path: string): InstallRecord {
  return record.seeded.includes(path) ? record : { ...record, seeded: [...record.seeded, path] }
}
