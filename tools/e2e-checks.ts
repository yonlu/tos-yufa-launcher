import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { sha256File } from '../packages/publish-cli/src/hash'
import { DXVK_FILE, DXVK_SHA256, INSTALL_RECORD_FILE, installRecordSchema, type InstallRecord } from '../packages/shared/src/index'

/**
 * Assertions the packaged-launcher smoke (tools/e2e-smoke.ts) makes about the
 * Compatibility fix (ADR 0003) in the game folder. Each throws with the
 * offending path in the message and resolves quietly when satisfied.
 */

/** The file the launcher writes outside the Install Record: the highest applied Patch archive revision. */
const REVISION_FILE = 'release/release.revision.txt'

export async function readInstallRecord(gameDir: string): Promise<InstallRecord> {
  return installRecordSchema.parse(JSON.parse(await readFile(join(gameDir, INSTALL_RECORD_FILE), 'utf8')))
}

/**
 * `release/` holds exactly the files the Install Record lists under it, byte
 * for byte, plus the launcher's own revision file. A `d3d9.dll` left behind
 * by disable, or anything else the launcher did not install, fails it.
 */
export async function expectReleaseMatchesRecord(gameDir: string): Promise<void> {
  const record = await readInstallRecord(gameDir)
  const expected = new Map(record.files.filter((f) => f.path.startsWith('release/')).map((f) => [f.path, f.sha256]))
  const actual = await listFiles(join(gameDir, 'release'), gameDir)
  for (const path of actual) {
    if (path === REVISION_FILE) continue
    const sha = expected.get(path)
    if (sha === undefined) throw new Error(`${path} is in release/ but not in the Install Record`)
    if ((await sha256File(join(gameDir, ...path.split('/')))) !== sha) throw new Error(`${path} differs from the Install Record`)
  }
  for (const path of expected.keys()) {
    if (!actual.includes(path)) throw new Error(`${path} is in the Install Record but missing from release/`)
  }
}

/** The Compatibility fix file is in `release/` with the pinned hash, or not there at all. */
export async function expectCompatibilityFix(gameDir: string, expected: 'present' | 'absent'): Promise<void> {
  const file = join(gameDir, 'release', DXVK_FILE)
  const present = existsSync(file)
  if (expected === 'absent') {
    if (present) throw new Error(`release/${DXVK_FILE} is still in the game folder`)
    return
  }
  if (!present) throw new Error(`release/${DXVK_FILE} is missing from the game folder`)
  const sha = await sha256File(file)
  if (sha !== DXVK_SHA256) throw new Error(`release/${DXVK_FILE} has hash ${sha}, the pin is ${DXVK_SHA256}`)
}

/** Every file under `dir`, as game-relative forward-slash paths, sorted. */
async function listFiles(dir: string, gameDir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listFiles(abs, gameDir)))
    else out.push(relative(gameDir, abs).split('\\').join('/'))
  }
  return out.sort()
}
