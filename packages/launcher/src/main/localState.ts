import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { PATCH_FILE_RE, type LocalPatchFile } from '@yufa/shared'

export interface GamePaths {
  gameDir: string
  patchDir: string
  releaseDir: string
  revisionFile: string
  clientExe: string
}

export function gamePaths(gameDir: string): GamePaths {
  const releaseDir = join(gameDir, 'release')
  return {
    gameDir,
    patchDir: join(gameDir, 'patch'),
    releaseDir,
    revisionFile: join(releaseDir, 'release.revision.txt'),
    clientExe: join(releaseDir, 'Yuka.exe'),
  }
}

export async function isValidGameDir(gameDir: string): Promise<boolean> {
  const p = gamePaths(gameDir)
  try {
    const [exe, patch] = await Promise.all([fs.stat(p.clientExe), fs.stat(p.patchDir)])
    return exe.isFile() && patch.isDirectory()
  } catch {
    return false
  }
}

export async function readLocalRevision(paths: GamePaths): Promise<number | null> {
  try {
    const raw = await fs.readFile(paths.revisionFile, 'utf8')
    const n = Number.parseInt(raw.trim(), 10)
    return Number.isSafeInteger(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

export async function writeLocalRevision(paths: GamePaths, revision: number): Promise<void> {
  const tmp = `${paths.revisionFile}.tmp`
  await fs.writeFile(tmp, String(revision), 'utf8')
  await fs.rename(tmp, paths.revisionFile)
}

export async function scanPatchDir(paths: GamePaths): Promise<LocalPatchFile[]> {
  const out: LocalPatchFile[] = []
  for (const name of await fs.readdir(paths.patchDir)) {
    if (!PATCH_FILE_RE.test(name)) continue
    const st = await fs.stat(join(paths.patchDir, name)).catch(() => null)
    if (st?.isFile()) out.push({ name, size: st.size })
  }
  return out
}

export async function deletePatchFile(paths: GamePaths, name: string): Promise<void> {
  if (!PATCH_FILE_RE.test(name)) throw new Error(`refusing to delete non-patch file: ${name}`)
  await fs.rm(join(paths.patchDir, name), { force: true })
}

export async function cleanupStaleParts(paths: GamePaths, maxAgeMs = 7 * 24 * 3600 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs
  let names: string[]
  try {
    names = await fs.readdir(paths.patchDir)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.endsWith('.part')) continue
    const full = join(paths.patchDir, name)
    const st = await fs.stat(full).catch(() => null)
    if (st && st.mtimeMs < cutoff) await fs.rm(full, { force: true }).catch(() => {})
  }
}

export async function probePatchDirWritable(paths: GamePaths): Promise<boolean> {
  const probe = join(paths.patchDir, '.yufa-write-probe')
  try {
    await fs.writeFile(probe, 'x')
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}
