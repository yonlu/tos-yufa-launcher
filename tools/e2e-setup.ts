import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { loadManifest, release, type Ctx } from '../packages/publish-cli/src/commands'
import { DEFAULT_EXCLUDES, DEFAULT_INCLUDES, DEFAULT_SEED_ONCE, type PublishConfig } from '../packages/publish-cli/src/config'
import { LocalDirStore } from '../packages/publish-cli/src/store'
import { patchFileName } from '../packages/shared/src/index'
import { argOption, isMainModule } from './cli'

/**
 * Local end-to-end sandbox: a fake full game tree (data, patch, release with
 * Player-owned and Seed-once files and hard-guarded junk) published as a Build
 * into a local store, plus an empty game folder for the launcher to install
 * into. Serve the store with tools/dev-server.ts and point the launcher at it
 * with YUFA_MANIFEST_URL / YUFA_GAME_DIR / YUFA_USERDATA.
 *
 *   npx tsx tools/e2e-setup.ts --base <dir> [--url http://127.0.0.1:8787/] [--count 2] [--size 3000000]
 *   npx tsx tools/e2e-setup.ts --base <dir> --bump     # Build N+1: one file changed, one patch archive added
 *
 * The sandbox carries its own publish.config.json, so the CLI can act on the
 * store too:  yufa-publish --config <dir>/publish.config.json --local-out <dir>/store rollback 1
 */

export const BASE_REVISION = 1116000
/** The Managed File `--bump` rewrites; any small non-archive file will do. */
export const BUMPED_FILE = 'release/a.dll'

export interface SandboxPaths {
  base: string
  /** Where the launcher installs; created empty. */
  gameDir: string
  /** The local store (serve it); layout identical to the R2 bucket. */
  storeDir: string
  /** The fake game folder Builds are released from. */
  treeDir: string
  /** A publish.config.json whose publicBaseUrl is the dev server. */
  configFile: string
  /** The publish CLI's hash cache for `tree/`; kept out of the tree so it is never published. */
  hashCache: string
}

export function sandboxPaths(base: string): SandboxPaths {
  const root = resolve(base)
  return {
    base: root,
    gameDir: join(root, 'game'),
    storeDir: join(root, 'store'),
    treeDir: join(root, 'tree'),
    configFile: join(root, 'publish.config.json'),
    hashCache: join(root, 'hash-cache.json'),
  }
}

export interface SandboxOptions {
  base: string
  /** Public base URL the dev server will answer at; must end with `/`. */
  url: string
  /** Where the publish CLI's progress lines go; console by default. */
  log?: (msg: string) => void
}

export interface BuildSandboxOptions extends SandboxOptions {
  /** Patch archives in the first Build. */
  count: number
  /** Bytes per patch archive. */
  size: number
}

export interface SandboxResult {
  build: number
  manifestUrl: string
  paths: SandboxPaths
}

export interface BumpResult extends SandboxResult {
  /** Game-relative path of the Managed File whose content changed. */
  changed: string
  /** Game-relative path of the patch archive added. */
  added: string
}

function sandboxConfig(paths: SandboxPaths, url: string): PublishConfig {
  return {
    bucket: 'e2e',
    endpoint: 'https://example.invalid',
    publicBaseUrl: url,
    manifestKey: 'manifest.json',
    manifestsPrefix: 'manifests/',
    objectsPrefix: 'objects/',
    redistPrefix: 'redist/',
    newsKey: 'news/news.json',
    newsImagesPrefix: 'news/img/',
    launcherPrefix: 'launcher/',
    excludes: [...DEFAULT_EXCLUDES],
    includes: [...DEFAULT_INCLUDES],
    seedOnce: [...DEFAULT_SEED_ONCE],
    hashCache: paths.hashCache,
  }
}

/** The publish CLI's view of the sandbox: the store under `base`, URLs on the dev server. */
export function sandboxCtx(opts: SandboxOptions): Ctx {
  if (!opts.url.endsWith('/')) throw new Error('--url must end with /')
  const paths = sandboxPaths(opts.base)
  return { cfg: sandboxConfig(paths, opts.url), store: new LocalDirStore(paths.storeDir), log: opts.log }
}

async function put(treeDir: string, rel: string, content: Buffer | string): Promise<void> {
  const abs = join(treeDir, ...rel.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

/** Builds the fake tree and publishes it as the first Build. Reuses nothing: call once per sandbox. */
export async function buildSandbox(opts: BuildSandboxOptions): Promise<SandboxResult> {
  const ctx = sandboxCtx(opts)
  const paths = sandboxPaths(opts.base)
  const { treeDir } = paths
  await mkdir(paths.gameDir, { recursive: true })
  await mkdir(paths.storeDir, { recursive: true })

  // the fake full game tree: data archives, `count` patch archives of `size` bytes, a client, a Seed-once layout
  await put(treeDir, 'data/bg.ipf', randomBytes(256 * 1024))
  await put(treeDir, 'data/ui.ipf', randomBytes(64 * 1024))
  await put(treeDir, 'release/Yuka.exe', 'stub client - not a real executable')
  await put(treeDir, BUMPED_FILE, randomBytes(16 * 1024))
  await put(treeDir, 'release/uilayout.xml', '<layout/>')
  for (let i = 1; i <= opts.count; i++) await put(treeDir, `patch/${patchFileName(BASE_REVISION + i)}`, randomBytes(opts.size))
  // Player-owned junk the hard guard must drop
  await put(treeDir, 'release/user.xml', '<user login="operator"/>')
  await put(treeDir, 'release/release.revision.txt', String(BASE_REVISION + opts.count))
  await put(treeDir, 'release/screenshot/shot.png', randomBytes(1024))
  await put(treeDir, 'release/log_Client/x.log', 'log')
  // excluded by the default config
  await put(treeDir, 'release/patch/junk.ipf', randomBytes(64))

  // the same view for the CLI by hand: rollback / patch / verify against this store
  await writeFile(paths.configFile, JSON.stringify({ ...ctx.cfg, hashCache: 'hash-cache.json' }, null, 2))

  const manifest = await release(ctx, { dir: treeDir, label: 'e2e' })

  await ctx.store.putText(
    'news/news.json',
    JSON.stringify({
      schemaVersion: 1,
      items: [
        {
          id: 'e2e-1',
          date: '2026-07-01',
          pinned: true,
          title: { 'pt-BR': 'Ambiente de teste E2E', en: 'E2E test environment' },
          body: {
            'pt-BR': 'Este manifest é servido pelo dev-server local. Instale, atualize e clique em Jogar.',
            en: 'This manifest is served by the local dev-server. Install, update and hit Play.',
          },
        },
        {
          id: 'e2e-2',
          date: '2026-06-28',
          title: { 'pt-BR': 'Segunda notícia', en: 'Second news item' },
          body: { 'pt-BR': 'Um card comum, sem destaque.', en: 'A regular, unpinned card.' },
        },
      ],
    }),
  )

  return { build: manifest.build, manifestUrl: `${opts.url}manifest.json`, paths }
}

/**
 * Publishes the next Build from the same tree with one Managed File rewritten
 * and one patch archive added above the current revision, so an update (two
 * downloads) and a later rollback (one delete, one restore) can be rehearsed.
 */
export async function bumpSandbox(opts: SandboxOptions): Promise<BumpResult> {
  const ctx = sandboxCtx(opts)
  const paths = sandboxPaths(opts.base)
  if (!existsSync(paths.treeDir) || !existsSync(join(paths.storeDir, 'manifest.json'))) {
    throw new Error(`${paths.base} holds no sandbox; run e2e-setup without --bump first`)
  }
  const current = await loadManifest(ctx)
  if (!current) throw new Error(`${paths.storeDir} has no Current Manifest; run e2e-setup without --bump first`)

  const revision = Math.max(current.revision, BASE_REVISION) + 1
  const added = `patch/${patchFileName(revision)}`
  const archiveBytes = current.files.find((f) => f.path.startsWith('patch/'))?.size ?? 64 * 1024
  await put(paths.treeDir, added, randomBytes(archiveBytes))
  const previous = await readFile(join(paths.treeDir, ...BUMPED_FILE.split('/')))
  await put(paths.treeDir, BUMPED_FILE, randomBytes(previous.length))
  // the hard-guarded revision file drifts too, as it would in a real folder
  await put(paths.treeDir, 'release/release.revision.txt', String(revision))

  const manifest = await release(ctx, { dir: paths.treeDir, label: `e2e-bump-${revision}` })
  return { build: manifest.build, manifestUrl: `${opts.url}manifest.json`, paths, changed: BUMPED_FILE, added }
}

// CLI mode
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  const opt = (name: string, fallback: string): string => argOption(args, name, fallback)
  const base = resolve(opt('base', './e2e-sandbox'))
  const url = opt('url', 'http://127.0.0.1:8787/')
  const bump = args.includes('--bump') ? await bumpSandbox({ base, url }) : null
  const result: SandboxResult =
    bump ?? (await buildSandbox({ base, url, count: Number(opt('count', '2')), size: Number(opt('size', '3000000')) }))
  const { paths } = result
  console.log(
    JSON.stringify(
      {
        build: result.build,
        ...(bump ? { changed: bump.changed, added: bump.added } : {}),
        gameDir: paths.gameDir,
        storeDir: paths.storeDir,
        manifestUrl: result.manifestUrl,
        serve: `npx tsx tools/dev-server.ts --root "${paths.storeDir}" --port 8787`,
        rollback: `npm run yufa-publish -- --config "${paths.configFile}" --local-out "${paths.storeDir}" rollback 1`,
      },
      null,
      2,
    ),
  )
}
