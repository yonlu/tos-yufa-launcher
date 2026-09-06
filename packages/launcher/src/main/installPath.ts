import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, normalize, parse, resolve } from 'node:path'
import type { InstallPathCheck, InstallPathProblem } from '@yufa/shared'
import { DISK_SPACE_MARGIN_BYTES, freeBytes as driveFreeBytes } from './download'
import { gamePaths, hasClientExe, readInstallRecord } from './localState'

export interface InstallPathDeps {
  /** Folders (and everything below them) an install is refused in; defaults to the system's. */
  forbiddenRoots?: string[]
  /** Free bytes on the drive holding an existing folder. */
  freeBytes?: (dir: string) => Promise<number>
  /** Whether a folder can be created inside the given existing folder. */
  probeWritable?: (dir: string) => Promise<boolean>
}

/** Canonical form for prefix comparison: resolved, backslashes, lower-case, no trailing separator. */
function canonical(path: string): string {
  const n = normalize(resolve(path)).replace(/\//g, '\\').toLowerCase()
  return n.length > 3 ? n.replace(/\\+$/, '') : n
}

/** True when `path` is one of `roots` or lives below one. */
export function isUnderAny(path: string, roots: readonly string[]): boolean {
  const p = canonical(path)
  return roots.some((root) => {
    const r = canonical(root)
    return p === r || p.startsWith(`${r}\\`)
  })
}

/** Program Files (both, plus the 64-bit alias under WOW64) and the Windows folder. */
export function systemForbiddenRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = [env['ProgramFiles'], env['ProgramFiles(x86)'], env['ProgramW6432'], env['SystemRoot'], env['windir']]
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of raw) {
    if (!dir) continue
    const key = canonical(dir)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(dir)
  }
  return out
}

/** A usable install path is absolute with a drive or UNC root. */
function isUsablePath(path: string): boolean {
  return path.trim() !== '' && isAbsolute(path) && parse(path).root !== ''
}

/** The deepest folder on the way to `path` that exists today (the path itself when it does). */
export async function nearestExistingAncestor(path: string): Promise<string | null> {
  let current = resolve(path)
  for (;;) {
    const st = await fs.stat(current).catch(() => null)
    if (st?.isDirectory()) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Can the install create its folder tree here? Probes by making and removing
 * a throw-away directory, not a file: a drive root lets a Windows user create
 * folders (which they then own) while refusing loose files, and the default
 * install folder anchors at exactly such a root on a fresh machine.
 */
export async function probeDirCreatable(dir: string): Promise<boolean> {
  let probe: string
  try {
    probe = await fs.mkdtemp(join(dir, '.yufa-probe-'))
  } catch {
    return false
  }
  await fs.rmdir(probe).catch(() => {})
  return true
}

/**
 * Judges a candidate install folder without creating it: it must be an
 * absolute path outside Program Files and Windows, its nearest existing
 * ancestor must let a folder be created, and its drive must hold the whole
 * Build plus the safety margin. Also reports what the folder already
 * contains, so the panel can offer Resume instead of Install.
 */
export async function validateInstallPath(
  path: string,
  buildBytes: number | null,
  deps: InstallPathDeps = {},
): Promise<InstallPathCheck> {
  const problems: InstallPathProblem[] = []
  const requiredBytes = buildBytes === null ? null : buildBytes + DISK_SPACE_MARGIN_BYTES
  if (!isUsablePath(path)) {
    return { path, ok: false, problems: ['invalid'], freeBytes: null, requiredBytes, existing: 'none' }
  }
  const target = resolve(path.trim())

  if (isUnderAny(target, deps.forbiddenRoots ?? systemForbiddenRoots())) problems.push('forbidden')

  // A missing drive is one problem (nowhere to write), not two.
  const anchor = await nearestExistingAncestor(target)
  let freeBytes: number | null = null
  if (anchor === null) {
    problems.push('not-writable')
  } else {
    if (!(await (deps.probeWritable ?? probeDirCreatable)(anchor))) problems.push('not-writable')
    freeBytes = await (deps.freeBytes ?? driveFreeBytes)(anchor).catch(() => null)
    if (requiredBytes === null) problems.push('no-manifest')
    else if (freeBytes === null || freeBytes < requiredBytes) problems.push('not-enough-space')
  }

  const paths = gamePaths(target)
  const record = await readInstallRecord(paths)
  let existing: InstallPathCheck['existing'] = 'none'
  if (record) existing = record.completed ? 'complete' : 'partial'
  else if (await hasClientExe(paths)) existing = 'partial'

  return { path, ok: problems.length === 0, problems, freeBytes, requiredBytes, existing }
}
