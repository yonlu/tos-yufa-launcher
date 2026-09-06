import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  INSTALL_RECORD_FILE,
  installRecordSchema,
  isGameRelativePath,
  type InstallRecord,
  type LocalFileStat,
} from '@yufa/shared'

export interface GamePaths {
  gameDir: string
  patchDir: string
  releaseDir: string
  revisionFile: string
  clientExe: string
  recordFile: string
}

export function gamePaths(gameDir: string): GamePaths {
  const releaseDir = join(gameDir, 'release')
  return {
    gameDir,
    patchDir: join(gameDir, 'patch'),
    releaseDir,
    revisionFile: join(releaseDir, 'release.revision.txt'),
    clientExe: join(releaseDir, 'Yuka.exe'),
    recordFile: join(gameDir, INSTALL_RECORD_FILE),
  }
}

/** Absolute path of a game-relative manifest path. Refuses anything that could escape the folder. */
export function absoluteGamePath(paths: GamePaths, relPath: string): string {
  if (!isGameRelativePath(relPath)) throw new Error(`refusing non game-relative path: ${relPath}`)
  return join(paths.gameDir, ...relPath.split('/'))
}

async function isFile(path: string): Promise<boolean> {
  const st = await fs.stat(path).catch(() => null)
  return !!st?.isFile()
}

export function hasClientExe(paths: GamePaths): Promise<boolean> {
  return isFile(paths.clientExe)
}

/**
 * A valid game folder holds a readable Install Record, or at least the
 * client executable (a located existing install — treated as incomplete and
 * healed by a check). Anything else is "not installed".
 */
export async function isValidGameDir(gameDir: string): Promise<boolean> {
  const p = gamePaths(gameDir)
  return (await readInstallRecord(p)) !== null || (await hasClientExe(p))
}

export async function readInstallRecord(paths: GamePaths): Promise<InstallRecord | null> {
  let raw: string
  try {
    raw = await fs.readFile(paths.recordFile, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = installRecordSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file)
}

export async function writeInstallRecord(paths: GamePaths, record: InstallRecord): Promise<void> {
  await writeAtomic(paths.recordFile, JSON.stringify(record, null, 2))
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
  await writeAtomic(paths.revisionFile, String(revision))
}

/**
 * Stats every given game-relative path; absent ones are simply not in the
 * result. mtime is kept at millisecond precision so a value written to the
 * Install Record compares equal to a later stat of the same file.
 */
export async function scanLocalFiles(
  paths: GamePaths,
  relPaths: Iterable<string>,
): Promise<Map<string, LocalFileStat>> {
  const out = new Map<string, LocalFileStat>()
  const pending: Promise<void>[] = []
  for (const rel of relPaths) {
    pending.push(
      fs.stat(absoluteGamePath(paths, rel)).then(
        (st) => {
          if (st.isFile()) out.set(rel, { size: st.size, mtimeMs: Math.floor(st.mtimeMs) })
        },
        () => {},
      ),
    )
  }
  await Promise.all(pending)
  return out
}

export async function statGameFile(paths: GamePaths, relPath: string): Promise<LocalFileStat> {
  const st = await fs.stat(absoluteGamePath(paths, relPath))
  return { size: st.size, mtimeMs: Math.floor(st.mtimeMs) }
}

export async function deleteGameFile(paths: GamePaths, relPath: string): Promise<void> {
  await fs.rm(absoluteGamePath(paths, relPath), { force: true })
}

/**
 * Removes `.part` leftovers older than a week from the directories the
 * Install Record names — the only places the launcher ever downloads into,
 * so Player-owned folders are never walked.
 */
export async function cleanupStaleParts(paths: GamePaths, maxAgeMs = 7 * 24 * 3600 * 1000): Promise<void> {
  const record = await readInstallRecord(paths)
  if (!record) return
  const cutoff = Date.now() - maxAgeMs
  const dirs = new Set(record.files.map((f) => dirname(absoluteGamePath(paths, f.path))))
  for (const dir of dirs) {
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.part')) continue
      const full = join(dir, name)
      const st = await fs.stat(full).catch(() => null)
      if (st?.isFile() && st.mtimeMs < cutoff) await fs.rm(full, { force: true }).catch(() => {})
    }
  }
}

/** Checks that the (existing) game folder accepts writes. */
export async function probeGameDirWritable(paths: GamePaths): Promise<boolean> {
  const probe = join(paths.gameDir, '.yufa-write-probe')
  try {
    await fs.writeFile(probe, 'x')
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}
