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
import { walkGameDir, type WalkOptions } from './tree'

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

/** Build numbers of every stored Manifest, highest first. */
async function storedBuildNumbers(ctx: Ctx): Promise<number[]> {
  const builds: number[] = []
  for (const obj of await ctx.store.list(ctx.cfg.manifestsPrefix)) {
    const m = /^(\d+)\.json$/.exec(obj.key.slice(ctx.cfg.manifestsPrefix.length))
    if (m) builds.push(Number(m[1]))
  }
  return builds.sort((a, b) => b - a)
}

/** The stored Manifest for `build`, with the exact text it was published as; null when there is none. */
async function loadStoredManifest(ctx: Ctx, build: number): Promise<{ text: string; manifest: Manifest } | null> {
  const text = await ctx.store.getText(storedManifestKey(ctx, build))
  if (text === null) return null
  return { text, manifest: manifestSchema.parse(JSON.parse(text)) }
}

/** The same walk `release` publishes from, so a mirror check sees exactly the publishable files. */
function gameDirWalkOptions(ctx: Ctx): WalkOptions {
  return { excludes: ctx.cfg.excludes, skipAbsolute: [ctx.cfg.hashCache] }
}

/**
 * Builds are immutable, so the next number is one above the highest stored
 * Manifest — not above the current one, which rollback may have lowered.
 */
async function nextBuildNumber(ctx: Ctx, current: Manifest | null): Promise<number> {
  return Math.max(current?.build ?? 0, ...(await storedBuildNumbers(ctx))) + 1
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
  const walked = await walkGameDir(args.dir, gameDirWalkOptions(ctx))
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
  const stored = await loadStoredManifest(ctx, build)
  if (!stored) throw new Error(`no stored manifest for build ${build}`)
  const { text, manifest } = stored
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

export interface VerifyArgs {
  /** A local game folder to compare against the Current Manifest, hash by hash. */
  mirror?: string
}

/**
 * Every Blob the Current Manifest references exists in the store with the
 * right size. With `mirror`, the folder is walked with the same rules as
 * `release` and every publishable file must match the Manifest by path and
 * hash, with nothing missing on either side.
 */
export async function verify(ctx: Ctx, args: VerifyArgs = {}): Promise<VerifyResult> {
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
  if (args.mirror) problems.push(...(await compareMirror(ctx, manifest, args.mirror)))

  if (problems.length) log(`verify FAILED:\n${problems.map((p) => '  ' + p).join('\n')}`)
  else {
    log(
      `verify OK: build ${manifest.build}, ${manifest.files.length} file(s), ${checked.size} blob(s) consistent` +
        (args.mirror ? `, mirror ${args.mirror} matches.` : '.'),
    )
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Problems sorted by path: hash differs, missing from the Mirror, or in the
 * Mirror but unpublished. Every file is hashed for real — the hash cache
 * trusts size+mtime, which is exactly what a verification must not do.
 */
async function compareMirror(ctx: Ctx, manifest: Manifest, dir: string): Promise<string[]> {
  const local = new Map<string, { path: string; sha256: string }>()
  for (const w of await walkGameDir(dir, gameDirWalkOptions(ctx))) {
    local.set(w.relPath.toLowerCase(), { path: w.relPath, sha256: await hasher(ctx)(w.absPath) })
  }

  const problems: string[] = []
  const seen = new Set<string>()
  for (const f of manifest.files) {
    const key = f.path.toLowerCase()
    seen.add(key)
    const l = local.get(key)
    if (!l) problems.push(`${f.path}: missing from mirror`)
    else if (l.sha256 !== f.sha256) problems.push(`${f.path}: mirror has ${l.sha256}, manifest says ${f.sha256}`)
  }
  for (const [key, l] of local) {
    if (!seen.has(key)) problems.push(`${l.path}: in mirror but not in manifest`)
  }
  return problems.sort(comparePaths)
}

export interface GcArgs {
  /** How many of the newest Builds keep their Blobs alive. */
  keep: number
}

export interface GcResult {
  /** Build numbers whose Blobs were retained, newest first; the Current Manifest's build is always among them. */
  kept: number[]
  /** Keys deleted (or, under dry-run, that would have been). */
  deleted: string[]
}

/**
 * gc deletes everything under the Blob prefix that no retained Build
 * references, so nothing else may live under it — a config that nests the
 * Current Manifest there would let gc delete it.
 */
function assertBlobPrefixIsolated(cfg: PublishConfig): void {
  const others: [string, string][] = [
    ['manifestKey', cfg.manifestKey],
    ['manifestsPrefix', cfg.manifestsPrefix],
    ['newsKey', cfg.newsKey],
    ['newsImagesPrefix', cfg.newsImagesPrefix],
    ['launcherPrefix', cfg.launcherPrefix],
    ['redistPrefix', cfg.redistPrefix],
  ]
  for (const [name, value] of others) {
    if (value.startsWith(cfg.objectsPrefix)) {
      throw new Error(`${name} (${value}) lies under objectsPrefix (${cfg.objectsPrefix}); gc refuses to run`)
    }
  }
}

/**
 * Deletes every Blob no retained Build references. Retained: the N highest
 * stored build numbers plus the Current Manifest's build, so a rollback
 * target can never lose its Blobs. Only keys under the Blob prefix are ever
 * deleted; stored Manifests are never touched. Do not run it while a
 * release or patch is in flight: Blobs are uploaded before the Manifest that
 * references them exists, and gc would see them as unreferenced.
 */
export async function gc(ctx: Ctx, args: GcArgs): Promise<GcResult> {
  const log = logger(ctx)
  if (!Number.isSafeInteger(args.keep) || args.keep < 1) throw new Error('gc --keep needs a positive integer')
  assertBlobPrefixIsolated(ctx.cfg)
  const current = await loadManifest(ctx)
  if (!current) throw new Error('no manifest published')

  const builds = await storedBuildNumbers(ctx)
  const kept = builds.slice(0, args.keep)
  if (!kept.includes(current.build)) kept.push(current.build)

  const referenced = new Set(current.files.map((f) => f.sha256))
  for (const build of kept) {
    if (build === current.build) continue
    const stored = await loadStoredManifest(ctx, build)
    if (!stored) throw new Error(`stored manifest for build ${build} vanished during gc`)
    for (const f of stored.manifest.files) referenced.add(f.sha256)
  }

  const deleted: string[] = []
  let retained = 0
  for (const obj of await ctx.store.list(ctx.cfg.objectsPrefix)) {
    // list() promises this already; re-checked because this is the one destructive path
    if (!obj.key.startsWith(ctx.cfg.objectsPrefix)) continue
    if (referenced.has(obj.key.slice(ctx.cfg.objectsPrefix.length))) {
      retained++
      continue
    }
    await ctx.store.delete(obj.key)
    deleted.push(obj.key)
  }
  log(
    `gc: kept build(s) ${kept.join(', ')} (${referenced.size} referenced blob(s), ${retained} stored), ` +
      `deleted ${deleted.length} orphaned blob(s); ${builds.length} stored manifest(s) untouched.`,
  )
  return { kept, deleted }
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
