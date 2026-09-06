import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'

/** Globs dropped from every release unless the operator overrides `excludes`. */
export const DEFAULT_EXCLUDES: readonly string[] = ['release/patch/', '_CommonRedist/']

/**
 * Paths that ship despite `excludes`. `gecfg::InitConfig` in Client_tos.exe
 * opens `patch/updater.config.xml` for its `Config/URL[@Key="Revisions"]`
 * and aborts with "Can't load config files" when it is missing; nothing else
 * under `release/patch/` (IMC's updater, DirectX cabs, bitmaps) is read.
 */
export const DEFAULT_INCLUDES: readonly string[] = ['release/patch/updater.config.xml']

/** Files the launcher writes once and never touches again (the game rewrites them). */
export const DEFAULT_SEED_ONCE: readonly string[] = [
  'release/uilayout.xml',
  'release/hotkey_operator.xml',
  'release/hotkey_user.xml',
]

const configSchema = z.object({
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  publicBaseUrl: z.string().url().endsWith('/'),
  manifestKey: z.string().min(1).default('manifest.json'),
  manifestsPrefix: z.string().endsWith('/').default('manifests/'),
  objectsPrefix: z.string().endsWith('/').default('objects/'),
  redistPrefix: z.string().endsWith('/').default('redist/'),
  newsKey: z.string().min(1).default('news/news.json'),
  newsImagesPrefix: z.string().endsWith('/').default('news/img/'),
  launcherPrefix: z.string().endsWith('/').default('launcher/'),
  /**
   * Globs, game-relative with forward slashes: `*`/`?` stay inside one path
   * segment, `**` spans segments, a trailing `/` means the whole subtree, and
   * a pattern with no `/` at all matches that file name at any depth.
   */
  excludes: z.array(z.string().min(1)).default([...DEFAULT_EXCLUDES]),
  /**
   * Exact game-relative paths (no globs) published even when an `excludes`
   * pattern matches them. Never overrides the hard guard. Lets a whole
   * directory stay excluded while one file inside it ships — the client
   * refuses to start without `release/patch/updater.config.xml`.
   */
  includes: z.array(z.string().min(1)).default([...DEFAULT_INCLUDES]),
  /** Game-relative paths published as Seed-once instead of Managed. */
  seedOnce: z.array(z.string().min(1)).default([...DEFAULT_SEED_ONCE]),
  /** Hash cache file; relative paths resolve against the config file's directory. */
  hashCache: z.string().min(1).default('.yufa-hash-cache.json'),
})

export type PublishConfig = z.infer<typeof configSchema>

/** Loads publish.config.json from an explicit path, or walks up from cwd. */
export function loadConfig(explicitPath?: string): PublishConfig {
  let path = explicitPath
  if (!path) {
    let dir = resolve(process.cwd())
    for (;;) {
      const candidate = join(dir, 'publish.config.json')
      if (existsSync(candidate)) {
        path = candidate
        break
      }
      const parent = dirname(dir)
      if (parent === dir) throw new Error('publish.config.json not found (searched cwd and parents); pass --config')
      dir = parent
    }
  }
  const cfg = configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  return { ...cfg, hashCache: resolve(dirname(resolve(path)), cfg.hashCache) }
}
