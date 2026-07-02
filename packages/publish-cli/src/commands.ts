import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import {
  manifestSchema,
  newsFeedSchema,
  parsePatchFileName,
  type Manifest,
  type ManifestFile,
} from '@yufa/shared'
import type { PublishConfig } from './config'
import { sha256File } from './hash'
import { CACHE, CONTENT_TYPES, type PatchStore } from './store'

export interface Ctx {
  cfg: PublishConfig
  store: PatchStore
  log?: (msg: string) => void
}

function logger(ctx: Ctx): (msg: string) => void {
  return ctx.log ?? console.log
}

export function emptyManifest(cfg: PublishConfig): Manifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    minLauncherVersion: '1.0.0',
    revision: cfg.grandfatherRevision,
    baseUrl: cfg.publicBaseUrl + cfg.patchesPrefix,
    newsUrl: cfg.publicBaseUrl + cfg.newsKey,
    files: [],
  }
}

export async function loadManifest(ctx: Ctx): Promise<Manifest | null> {
  const text = await ctx.store.getText(ctx.cfg.manifestKey)
  if (text === null) return null
  return manifestSchema.parse(JSON.parse(text))
}

/** Every manifest write goes through here: re-validated, URLs refreshed from config. */
async function writeManifest(ctx: Ctx, manifest: Manifest): Promise<Manifest> {
  const normalized: Manifest = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    baseUrl: ctx.cfg.publicBaseUrl + ctx.cfg.patchesPrefix,
    newsUrl: ctx.cfg.publicBaseUrl + ctx.cfg.newsKey,
  }
  manifestSchema.parse(normalized)
  await ctx.store.putText(ctx.cfg.manifestKey, JSON.stringify(normalized, null, 2), {
    contentType: CONTENT_TYPES.json,
    cacheControl: CACHE.none,
  })
  return normalized
}

async function fileEntry(path: string): Promise<ManifestFile> {
  const name = basename(path)
  const revision = parsePatchFileName(name)
  if (revision === null) throw new Error(`${name} does not match <revision>_001001.ipf`)
  const st = await fs.stat(path)
  return { name, revision, size: st.size, sha256: await sha256File(path) }
}

async function uploadPatchFile(ctx: Ctx, entry: ManifestFile, path: string): Promise<void> {
  logger(ctx)(`uploading ${entry.name} (${entry.size} bytes)…`)
  await ctx.store.putFile(ctx.cfg.patchesPrefix + entry.name, path, {
    contentType: CONTENT_TYPES.ipf,
    cacheControl: CACHE.immutable,
  })
}

export interface SeedArgs {
  patchDir: string
  include: string[]
  exclude: string[]
}

/**
 * One-time initial manifest from an existing game install. Files above the
 * grandfather revision need an explicit --include/--exclude decision;
 * anything above the client's recorded revision gets an extra loud warning.
 */
export async function seed(ctx: Ctx, args: SeedArgs): Promise<Manifest> {
  const log = logger(ctx)
  const gf = ctx.cfg.grandfatherRevision

  let recordedRevision = gf
  try {
    const raw = await fs.readFile(join(args.patchDir, '..', 'release', 'release.revision.txt'), 'utf8')
    const parsed = Number.parseInt(raw.trim(), 10)
    if (Number.isSafeInteger(parsed)) recordedRevision = parsed
  } catch {
    log(`note: no readable release.revision.txt next to ${args.patchDir}; assuming ${gf}.`)
  }

  const names = await fs.readdir(args.patchDir)
  const candidates = names
    .filter((n) => (parsePatchFileName(n) ?? 0) > gf)
    .sort((a, b) => parsePatchFileName(a)! - parsePatchFileName(b)!)

  const unknown = [...args.include, ...args.exclude].filter((n) => !candidates.includes(n))
  if (unknown.length) {
    throw new Error(`--include/--exclude name(s) not found among candidates: ${unknown.join(', ')}`)
  }

  for (const name of candidates) {
    const rev = parsePatchFileName(name)!
    if (rev > recordedRevision) {
      log(`WARNING: ${name} (revision ${rev}) is ABOVE the recorded client revision ${recordedRevision}.`)
    }
  }

  const unresolved = candidates.filter((n) => !args.include.includes(n) && !args.exclude.includes(n))
  if (unresolved.length) {
    throw new Error(
      `seed found patch files above the grandfather revision (${gf}) that need an explicit decision:\n` +
        unresolved.map((n) => `  --include ${n}   or   --exclude ${n}`).join('\n'),
    )
  }

  const files: ManifestFile[] = []
  for (const name of candidates.filter((n) => args.include.includes(n))) {
    log(`hashing ${name}…`)
    files.push(await fileEntry(join(args.patchDir, name)))
  }

  const manifest: Manifest = {
    ...emptyManifest(ctx.cfg),
    revision: files.length ? files[files.length - 1]!.revision : gf,
    files,
  }

  for (const f of files) {
    await uploadPatchFile(ctx, f, join(args.patchDir, f.name))
  }
  const written = await writeManifest(ctx, manifest)
  log(`seeded manifest at revision ${written.revision} with ${files.length} file(s).`)
  return written
}

export interface PatchArgs {
  files: string[]
}

/** Publish new patch ipfs: objects first, manifest last. */
export async function patch(ctx: Ctx, args: PatchArgs): Promise<Manifest> {
  const log = logger(ctx)
  if (!args.files.length) throw new Error('no patch files given')

  const manifest = (await loadManifest(ctx)) ?? emptyManifest(ctx.cfg)

  const sorted = [...args.files].sort(
    (a, b) => (parsePatchFileName(basename(a)) ?? 0) - (parsePatchFileName(basename(b)) ?? 0),
  )
  const items: { path: string; entry: ManifestFile }[] = []
  let floor = manifest.revision
  for (const path of sorted) {
    const entry = await fileEntry(path)
    if (entry.revision <= floor) {
      throw new Error(
        `${entry.name}: revision ${entry.revision} must be greater than the current manifest revision ${floor}`,
      )
    }
    floor = entry.revision
    items.push({ path, entry })
  }

  const updated: Manifest = {
    ...manifest,
    revision: items[items.length - 1]!.entry.revision,
    files: [...manifest.files, ...items.map((i) => i.entry)],
  }

  for (const { path, entry } of items) {
    await uploadPatchFile(ctx, entry, path)
  }
  const written = await writeManifest(ctx, updated)
  log(`manifest now at revision ${written.revision} (${written.files.length} managed file(s)).`)
  return written
}

/** Drop every manifest entry above `revision`. Clients delete the dropped files locally. */
export async function rollback(ctx: Ctx, revision: number): Promise<Manifest> {
  const log = logger(ctx)
  if (!Number.isSafeInteger(revision)) throw new Error('rollback needs an integer revision')
  const manifest = await loadManifest(ctx)
  if (!manifest) throw new Error('no manifest published yet')
  const gf = ctx.cfg.grandfatherRevision
  if (revision < gf) throw new Error(`cannot roll back below the grandfather revision ${gf}`)

  const files = manifest.files.filter((f) => f.revision <= revision)
  const top = files.length ? files[files.length - 1]!.revision : gf
  if (top !== revision) log(`note: ${revision} is not an exact patch revision; rolling back to ${top}.`)
  const dropped = manifest.files.length - files.length

  const written = await writeManifest(ctx, { ...manifest, revision: top, files })
  log(`rolled back to revision ${top}; ${dropped} entr${dropped === 1 ? 'y' : 'ies'} removed.`)
  return written
}

export async function newsPush(ctx: Ctx, filePath: string): Promise<void> {
  const feed = newsFeedSchema.parse(JSON.parse(await fs.readFile(filePath, 'utf8')))
  await ctx.store.putText(ctx.cfg.newsKey, JSON.stringify(feed, null, 2), {
    contentType: CONTENT_TYPES.json,
    cacheControl: CACHE.none,
  })
  logger(ctx)(`news feed published (${feed.items.length} item(s)).`)
}

export interface VerifyResult {
  ok: boolean
  problems: string[]
}

/** Consistency check: every manifest entry exists in the store with the right size. */
export async function verify(ctx: Ctx, opts: { mirror?: string } = {}): Promise<VerifyResult> {
  const log = logger(ctx)
  const manifest = await loadManifest(ctx)
  if (!manifest) return { ok: false, problems: ['no manifest published'] }

  const problems: string[] = []
  for (const f of manifest.files) {
    const head = await ctx.store.head(ctx.cfg.patchesPrefix + f.name)
    if (!head) {
      problems.push(`${f.name}: missing from store`)
      continue
    }
    if (head.size !== f.size) problems.push(`${f.name}: stored size ${head.size} != manifest ${f.size}`)
    if (opts.mirror) {
      try {
        const hash = await sha256File(join(opts.mirror, f.name))
        if (hash !== f.sha256) problems.push(`${f.name}: mirror hash mismatch`)
      } catch {
        problems.push(`${f.name}: not found in mirror ${opts.mirror}`)
      }
    }
  }

  if (problems.length) log(`verify FAILED:\n${problems.map((p) => '  ' + p).join('\n')}`)
  else log(`verify OK: ${manifest.files.length} file(s) consistent at revision ${manifest.revision}.`)
  return { ok: problems.length === 0, problems }
}

/** Upload an electron-builder output dir: installers/blockmaps first, latest.yml last. */
export async function publishLauncher(ctx: Ctx, distDir: string, minLauncher?: string): Promise<void> {
  const log = logger(ctx)
  const names = await fs.readdir(distDir)
  if (!names.includes('latest.yml')) {
    throw new Error(`latest.yml not found in ${distDir} — run the electron-builder build first`)
  }
  const artifacts = names.filter((n) => n.endsWith('.exe') || n.endsWith('.blockmap'))
  if (!artifacts.some((n) => n.endsWith('.exe'))) {
    throw new Error(`no installer .exe found in ${distDir}`)
  }

  for (const name of artifacts) {
    log(`uploading ${name}…`)
    await ctx.store.putFile(ctx.cfg.launcherPrefix + name, join(distDir, name), {
      contentType: CONTENT_TYPES.binary,
      cacheControl: CACHE.immutable,
    })
  }
  await ctx.store.putFile(ctx.cfg.launcherPrefix + 'latest.yml', join(distDir, 'latest.yml'), {
    contentType: CONTENT_TYPES.yaml,
    cacheControl: CACHE.none,
  })
  log('launcher feed published (latest.yml last).')

  if (minLauncher) {
    const manifest = await loadManifest(ctx)
    if (!manifest) throw new Error('cannot set minLauncherVersion: no manifest published yet')
    await writeManifest(ctx, { ...manifest, minLauncherVersion: minLauncher })
    log(`manifest minLauncherVersion set to ${minLauncher} — older launchers will force-update.`)
  }
}
