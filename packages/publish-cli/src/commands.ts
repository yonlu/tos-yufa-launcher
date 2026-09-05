import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import {
  comparePaths,
  deriveRevision,
  manifestSchema,
  MANIFEST_SCHEMA_VERSION,
  newsFeedSchema,
  parsePatchFileName,
  PATCH_DIR,
  type Manifest,
  type ManifestFile,
} from '@yufa/shared'
import type { PublishConfig } from './config'
import { HashCache, sha256File, type HashFile } from './hash'
import { CACHE, CONTENT_TYPES, type PublishStore } from './store'
import { walkGameDir } from './tree'

export interface Ctx {
  cfg: PublishConfig
  store: PublishStore
  log?: (msg: string) => void
  /** Injectable for tests that count hashing work. */
  hashFile?: HashFile
}

function logger(ctx: Ctx): (msg: string) => void {
  return ctx.log ?? console.log
}

const DEFAULT_MIN_LAUNCHER = '1.0.0'

export async function loadManifest(ctx: Ctx): Promise<Manifest | null> {
  const text = await ctx.store.getText(ctx.cfg.manifestKey)
  if (text === null) return null
  return manifestSchema.parse(JSON.parse(text))
}

/** Absolute path of a local file backing a Blob that may need uploading. */
type BlobSource = string

function hasher(ctx: Ctx): HashFile {
  return ctx.hashFile ?? sha256File
}

interface BuildSpec {
  files: ManifestFile[]
  label?: string
  minLauncherVersion: string
  /** Local sources for Blobs referenced by `files`; keyed by sha256. Absent ones must already be stored. */
  sources: Map<string, BlobSource>
}

function storedManifestKey(ctx: Ctx, build: number): string {
  return `${ctx.cfg.manifestsPrefix}${build}.json`
}

function blobKey(ctx: Ctx, sha256: string): string {
  return ctx.cfg.objectsPrefix + sha256
}

/**
 * Builds are immutable, so the next number is one above the highest stored
 * Manifest — not above the current one, which rollback may have lowered.
 */
async function nextBuildNumber(ctx: Ctx, current: Manifest | null): Promise<number> {
  let top = current?.build ?? 0
  for (const obj of await ctx.store.list(ctx.cfg.manifestsPrefix)) {
    const m = /^(\d+)\.json$/.exec(obj.key.slice(ctx.cfg.manifestsPrefix.length))
    if (m) top = Math.max(top, Number(m[1]))
  }
  return top + 1
}

/**
 * The one way a Build reaches the store: missing Blobs, then the immutable
 * stored Manifest, then the Current Manifest. Entries without a local
 * source must already be stored; publishing a Manifest that points at a
 * missing Blob is refused (ADR 0001).
 */
async function publishBuild(ctx: Ctx, current: Manifest | null, spec: BuildSpec): Promise<Manifest> {
  const log = logger(ctx)
  const files = [...spec.files].sort((a, b) => comparePaths(a.path, b.path))
  const manifest: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    build: await nextBuildNumber(ctx, current),
    ...(spec.label ? { label: spec.label } : {}),
    generatedAt: new Date().toISOString(),
    minLauncherVersion: spec.minLauncherVersion,
    blobBaseUrl: ctx.cfg.publicBaseUrl + ctx.cfg.objectsPrefix,
    newsUrl: ctx.cfg.publicBaseUrl + ctx.cfg.newsKey,
    revision: deriveRevision(files),
    files,
  }
  manifestSchema.parse(manifest)

  let uploaded = 0
  let present = 0
  const seen = new Set<string>()
  for (const f of files) {
    if (seen.has(f.sha256)) continue
    seen.add(f.sha256)
    const src = spec.sources.get(f.sha256)
    if (await ctx.store.head(blobKey(ctx, f.sha256))) {
      present++
      continue
    }
    if (!src) {
      throw new Error(`${f.path}: blob ${f.sha256} is missing from the store; run release to restore it`)
    }
    log(`uploading ${f.path} (${f.size} bytes) -> ${f.sha256.slice(0, 12)}…`)
    await ctx.store.putFile(blobKey(ctx, f.sha256), src, {
      contentType: CONTENT_TYPES.blob,
      cacheControl: CACHE.immutable,
    })
    uploaded++
  }

  const text = JSON.stringify(manifest, null, 2)
  await ctx.store.putText(storedManifestKey(ctx, manifest.build), text, {
    contentType: CONTENT_TYPES.json,
    cacheControl: CACHE.immutable,
  })
  await ctx.store.putText(ctx.cfg.manifestKey, text, {
    contentType: CONTENT_TYPES.json,
    cacheControl: CACHE.none,
  })
  log(
    `build ${manifest.build}${manifest.label ? ` (${manifest.label})` : ''} is current: ` +
      `${files.length} file(s), revision ${manifest.revision}, ` +
      `${uploaded} blob(s) uploaded, ${present} already stored.`,
  )
  return manifest
}

export interface ReleaseArgs {
  dir: string
  label?: string
  minLauncher?: string
}

/** Publish a complete Build from a local game folder. */
export async function release(ctx: Ctx, args: ReleaseArgs): Promise<Manifest> {
  const log = logger(ctx)
  const walked = await walkGameDir(args.dir, {
    excludes: ctx.cfg.excludes,
    skipAbsolute: [ctx.cfg.hashCache],
  })
  if (!walked.length) throw new Error(`${args.dir} contains no publishable files`)

  const seedOnce = new Set(ctx.cfg.seedOnce.map((p) => p.replace(/\\/g, '/').toLowerCase()))
  const cache = await HashCache.load(ctx.cfg.hashCache)
  const files: ManifestFile[] = []
  const sources = new Map<string, BlobSource>()
  for (const w of walked) {
    const sha256 = await cache.hash(w, hasher(ctx))
    files.push({
      path: w.relPath,
      size: w.size,
      sha256,
      class: seedOnce.has(w.relPath.toLowerCase()) ? 'seed-once' : 'managed',
    })
    if (!sources.has(sha256)) sources.set(sha256, w.absPath)
  }
  await cache.save()
  const { hits, misses } = cache.stats
  log(`scanned ${files.length} file(s): hashed ${misses}, ${hits} from cache (${ctx.cfg.hashCache} updated).`)

  const current = await loadManifest(ctx)
  return publishBuild(ctx, current, {
    files,
    label: args.label,
    minLauncherVersion: args.minLauncher ?? current?.minLauncherVersion ?? DEFAULT_MIN_LAUNCHER,
    sources,
  })
}

export interface PatchArgs {
  files: string[]
}

/** Publish a Build equal to the current one plus the given patch archives. */
export async function patch(ctx: Ctx, args: PatchArgs): Promise<Manifest> {
  if (!args.files.length) throw new Error('no patch files given')
  const current = await loadManifest(ctx)

  const sorted = [...args.files].sort(
    (a, b) => (parsePatchFileName(basename(a)) ?? 0) - (parsePatchFileName(basename(b)) ?? 0),
  )
  const added: ManifestFile[] = []
  const sources = new Map<string, BlobSource>()
  let floor = current?.revision ?? 0
  for (const path of sorted) {
    const name = basename(path)
    const revision = parsePatchFileName(name)
    if (revision === null) throw new Error(`${name} does not match <revision>_001001.ipf`)
    if (revision <= floor) {
      throw new Error(`${name}: revision ${revision} must be greater than the current revision ${floor}`)
    }
    floor = revision
    const st = await fs.stat(path)
    const sha256 = await hasher(ctx)(path)
    added.push({ path: `${PATCH_DIR}/${name}`, size: st.size, sha256, class: 'managed' })
    sources.set(sha256, path)
  }

  const addedPaths = new Set(added.map((f) => f.path))
  const files = [...(current?.files ?? []).filter((f) => !addedPaths.has(f.path)), ...added]
  return publishBuild(ctx, current, {
    files,
    minLauncherVersion: current?.minLauncherVersion ?? DEFAULT_MIN_LAUNCHER,
    sources,
  })
}

/** Make a stored Build current again. Writes only the Current Manifest. */
export async function rollback(ctx: Ctx, build: number): Promise<Manifest> {
  if (!Number.isSafeInteger(build) || build < 1) throw new Error('rollback needs a positive integer build number')
  const text = await ctx.store.getText(storedManifestKey(ctx, build))
  if (text === null) throw new Error(`no stored manifest for build ${build}`)
  const manifest = manifestSchema.parse(JSON.parse(text))
  await ctx.store.putText(ctx.cfg.manifestKey, text, {
    contentType: CONTENT_TYPES.json,
    cacheControl: CACHE.none,
  })
  logger(ctx)(`build ${build}${manifest.label ? ` (${manifest.label})` : ''} is current again (revision ${manifest.revision}).`)
  return manifest
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

/** Every Blob the Current Manifest references exists in the store with the right size. */
export async function verify(ctx: Ctx): Promise<VerifyResult> {
  const log = logger(ctx)
  const manifest = await loadManifest(ctx)
  if (!manifest) return { ok: false, problems: ['no manifest published'] }

  const problems: string[] = []
  const checked = new Map<string, { size: number } | null>()
  for (const f of manifest.files) {
    let head = checked.get(f.sha256)
    if (head === undefined) {
      head = await ctx.store.head(blobKey(ctx, f.sha256))
      checked.set(f.sha256, head)
    }
    if (!head) problems.push(`${f.path}: blob ${f.sha256} missing from store`)
    else if (head.size !== f.size) {
      problems.push(`${f.path}: blob ${f.sha256} has ${head.size} bytes, manifest says ${f.size}`)
    }
  }

  if (problems.length) log(`verify FAILED:\n${problems.map((p) => '  ' + p).join('\n')}`)
  else log(`verify OK: build ${manifest.build}, ${manifest.files.length} file(s), ${checked.size} blob(s) consistent.`)
  return { ok: problems.length === 0, problems }
}

/**
 * Upload an electron-builder output dir: installers/blockmaps first,
 * latest.yml last. With `minLauncher`, publish a new Build identical to
 * the current one but requiring that launcher version.
 */
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
    const current = await loadManifest(ctx)
    if (!current) throw new Error('cannot set minLauncherVersion: no manifest published yet')
    await publishBuild(ctx, current, {
      files: current.files,
      label: current.label,
      minLauncherVersion: minLauncher,
      sources: new Map(),
    })
    log(`minLauncherVersion is now ${minLauncher} — older launchers will force-update.`)
  }
}
