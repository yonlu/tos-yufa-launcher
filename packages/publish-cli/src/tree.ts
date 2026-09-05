import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { comparePaths } from '@yufa/shared'

/**
 * Directories the client writes at runtime. Never published: they hold
 * personal data (logs, screenshots, guild images, the operator's own
 * account folder). Guarded when found at the top level or under release/.
 */
const RUNTIME_DIRS: readonly string[] = [
  'DisconnectLog',
  'GuildBanner',
  'GuildEmblem',
  'GuildIntroImage',
  'UploadEmblem',
  'analyze',
  'avicapture',
  'dump',
  'log_Client',
  'replay',
  'screenshot',
  'spraysave',
  'tempfiles',
  'user',
  'fade',
]

/** Player-owned files written by the client at exit. Contain the login id and per-character state. */
const GUARDED_FILES: readonly string[] = [
  'release/user.xml',
  'release/user_c.xml',
  'release/hud_config.xml',
  'release/serverlist_recent.xml',
]

/** `.yufa-*` are the launcher's own files in the game folder (Install Record, write probe). */
const GUARDED_GLOBS: readonly string[] = ['release/chat_config_*.xml', 'release.revision.txt', '*.part', '.yufa-*']

const GUARDED_DIRS: readonly string[] = ['addons', ...RUNTIME_DIRS]

/**
 * Compiles a game-relative glob: `*` and `?` stay within one path segment,
 * `**` spans segments, a trailing `/` means the whole subtree, and a pattern
 * without any `/` matches a file name at any depth. Case-insensitive, since
 * the game folder lives on NTFS.
 */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, '/').replace(/^\.?\//, '')
  if (p.endsWith('/')) p += '**'
  if (!p.includes('/')) p = `**/${p}`
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!
    if (c === '*') {
      if (p[i + 1] === '*') {
        i++
        if (p[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

const guardedGlobs = GUARDED_GLOBS.map(globToRegExp)
const guardedFiles = new Set(GUARDED_FILES.map((f) => f.toLowerCase()))
const guardedDirs = new Set(GUARDED_DIRS.map((d) => d.toLowerCase()))

/**
 * The hard guard: true for Player-owned Files that must never be published,
 * whatever the config says (see CONTEXT.md — they carry the operator's login
 * and per-character state).
 */
export function isHardGuarded(relPath: string): boolean {
  const lower = relPath.toLowerCase()
  if (guardedFiles.has(lower)) return true
  if (guardedGlobs.some((re) => re.test(relPath))) return true
  const segs = lower.split('/')
  if (segs.length > 1 && guardedDirs.has(segs[0]!)) return true
  if (segs.length > 2 && segs[0] === 'release' && guardedDirs.has(segs[1]!)) return true
  return false
}

export interface WalkedFile {
  /** Game-relative, forward slashes, case preserved. */
  relPath: string
  absPath: string
  size: number
  mtimeMs: number
}

export interface WalkOptions {
  excludes: readonly string[]
  /** Absolute paths to skip regardless of rules (e.g. the hash cache if it lives inside the folder). */
  skipAbsolute?: readonly string[]
}

/**
 * Lists every publishable file under `dir`: applies the hard guard, then
 * the configured excludes. Guarded and excluded directories are pruned so a
 * huge screenshot folder costs nothing. Result is sorted by path.
 */
export async function walkGameDir(dir: string, opts: WalkOptions): Promise<WalkedFile[]> {
  const root = resolve(dir)
  const st = await fs.stat(root).catch(() => null)
  if (!st?.isDirectory()) throw new Error(`${dir} is not a directory`)

  const excludes = opts.excludes.map(globToRegExp)
  const skip = new Set((opts.skipAbsolute ?? []).map((p) => resolve(p).toLowerCase()))
  const dropped = (rel: string) => isHardGuarded(rel) || excludes.some((re) => re.test(rel))

  const out: WalkedFile[] = []
  const visit = async (absDir: string, relDir: string): Promise<void> => {
    const entries = await fs.readdir(absDir, { withFileTypes: true })
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      const abs = join(absDir, e.name)
      if (e.isDirectory()) {
        // a directory is prunable when every file under it would be dropped:
        // the guard/exclude rules for `dir/` match `dir/anything` too
        if (dropped(`${rel}/probe`) && dropped(`${rel}/a/probe`)) continue
        await visit(abs, rel)
      } else if (e.isFile()) {
        if (dropped(rel) || skip.has(abs.toLowerCase())) continue
        const s = await fs.stat(abs)
        out.push({ relPath: rel, absPath: abs, size: s.size, mtimeMs: s.mtimeMs })
      }
    }
  }
  await visit(root, '')
  return out.sort((a, b) => comparePaths(a.relPath, b.relPath))
}
