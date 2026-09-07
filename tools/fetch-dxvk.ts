import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'
import {
  DXVK_ARCHIVE_DLL,
  DXVK_FILE,
  DXVK_LICENSE_FILE,
  DXVK_LICENSE_URL,
  DXVK_RELEASE_URL,
  DXVK_SHA256,
  DXVK_VERSION,
} from '../packages/shared/src/index'
import { argOption, isMainModule } from './cli'

/**
 * Stages the Compatibility fix for a launcher build (ADR 0003): downloads the
 * official DXVK release archive and the LICENSE from the repository at the
 * release tag (the archive carries only DLLs) to a once-per-machine cache,
 * pulls `x32/d3d9.dll` out of the archive, checks it against the pin in
 * packages/shared and writes DLL and licence into
 * packages/launcher/build/dxvk/, which electron-builder ships as an extra
 * resource. A DLL that does not match the pin is refused and nothing is
 * staged. The DLL is never committed.
 *
 *   npm run fetch-dxvk                       # stage into packages/launcher/build/dxvk
 *   npm run fetch-dxvk -- --refresh          # download again even if cached
 *   npm run fetch-dxvk -- --cache <dir> --out <dir> --url <archive url> --license-url <url>
 */

const here = dirname(fileURLToPath(import.meta.url))
/** Where electron-builder expects the staged files (electron-builder.yml, extraResources). */
export const DEFAULT_STAGE_DIR = resolve(here, '..', 'packages', 'launcher', 'build', 'dxvk')

/** Per-machine download cache: %LOCALAPPDATA% on Windows, XDG cache elsewhere; YUFA_DXVK_CACHE overrides. */
export function defaultCacheDir(): string {
  const fromEnv = process.env['YUFA_DXVK_CACHE']
  if (fromEnv) return resolve(fromEnv)
  const root = process.env['LOCALAPPDATA'] ?? process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache')
  return join(root, 'yufa-launcher', 'dxvk')
}

export class DxvkPinMismatch extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
    readonly tarball: string,
  ) {
    super(
      `${DXVK_ARCHIVE_DLL} in ${tarball} does not match the pin in packages/shared/src/dxvk.ts\n` +
        `  pinned: ${expected}\n  actual: ${actual}\n` +
        'Nothing was staged. If the archive is the official release, the pin is wrong: fix DXVK_SHA256. ' +
        'If the pin is right, the download is not the official archive: delete it and run again with --refresh.',
    )
    this.name = 'DxvkPinMismatch'
  }
}

export interface StageOptions {
  /** The release archive (`dxvk-<version>.tar.gz`). */
  tarball: string
  /** DXVK's LICENSE text, already on disk. */
  licenseFile: string
  /** Where `d3d9.dll` and `LICENSE` land. */
  stageDir: string
  /** Expected SHA-256 of `x32/d3d9.dll` (DXVK_SHA256 in packages/shared). */
  pin: string
}

export interface StageResult {
  dll: string
  license: string
  /** Hash of the staged DLL (equals the pin). */
  sha256: string
}

/** Strips the archive's single top-level folder (`dxvk-2.5/x32/d3d9.dll` → `x32/d3d9.dll`). */
function archiveRelativePath(entryPath: string): string {
  const parts = entryPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(1).join('/')
}

/** Reads the x86 DLL out of the archive without unpacking the rest to disk. */
async function readArchiveDll(tarball: string): Promise<Buffer> {
  let dll: Buffer | undefined
  const reads: Promise<void>[] = []
  await tar.t({
    file: tarball,
    filter: (p) => archiveRelativePath(p) === DXVK_ARCHIVE_DLL,
    onReadEntry: (entry) => {
      const chunks: Buffer[] = []
      entry.on('data', (c: Buffer) => chunks.push(c))
      reads.push(
        new Promise((done, fail) => {
          entry.on('end', () => ((dll = Buffer.concat(chunks)), done()))
          entry.on('error', fail)
        }),
      )
    },
  })
  await Promise.all(reads)
  if (!dll) throw new Error(`${tarball} has no ${DXVK_ARCHIVE_DLL}; is it the official DXVK release archive?`)
  return dll
}

async function readLicense(file: string): Promise<Buffer> {
  try {
    return await readFile(file)
  } catch {
    throw new Error(`no ${DXVK_LICENSE_FILE} at ${file}; download it from ${DXVK_LICENSE_URL}`)
  }
}

/**
 * Extracts and verifies, then stages. On any refusal the stage folder holds
 * neither file, even if an earlier run had left them there: a build must
 * never pick up a stale DLL.
 */
export async function stageDxvk(opts: StageOptions): Promise<StageResult> {
  const dllPath = join(opts.stageDir, DXVK_FILE)
  const licensePath = join(opts.stageDir, DXVK_LICENSE_FILE)
  const clearStage = async (): Promise<void> => {
    await rm(dllPath, { force: true })
    await rm(licensePath, { force: true })
  }

  let dll: Buffer
  let license: Buffer
  try {
    ;[dll, license] = await Promise.all([readArchiveDll(opts.tarball), readLicense(opts.licenseFile)])
  } catch (err) {
    await clearStage()
    throw err
  }
  const actual = createHash('sha256').update(dll).digest('hex')
  if (actual !== opts.pin.toLowerCase()) {
    await clearStage()
    throw new DxvkPinMismatch(opts.pin, actual, opts.tarball)
  }

  await mkdir(opts.stageDir, { recursive: true })
  await writeAtomic(dllPath, dll)
  await writeAtomic(licensePath, license)
  return { dll: dllPath, license: licensePath, sha256: actual }
}

async function writeAtomic(path: string, content: Buffer): Promise<void> {
  const tmp = `${path}.part`
  await writeFile(tmp, content)
  await rename(tmp, path)
}

export interface FetchOptions {
  cacheDir: string
  stageDir: string
  url?: string
  licenseUrl?: string
  /** Defaults to DXVK_SHA256. */
  pin?: string
  /** Download again even when the cache already holds the archive. */
  refresh?: boolean
  fetchImpl?: typeof fetch
  log?: (msg: string) => void
}

export interface FetchResult extends StageResult {
  tarball: string
  /** False when the cache already held both downloads. */
  downloaded: boolean
}

/** Downloads the archive and the licence once per machine (kept under `cacheDir`), then stages from them. */
export async function fetchDxvk(opts: FetchOptions): Promise<FetchResult> {
  const url = opts.url ?? DXVK_RELEASE_URL
  const licenseUrl = opts.licenseUrl ?? DXVK_LICENSE_URL
  const pin = opts.pin ?? DXVK_SHA256
  const log = opts.log ?? ((msg: string) => console.log(msg))
  const fetchImpl = opts.fetchImpl ?? fetch
  const tarball = join(opts.cacheDir, decodeURIComponent(new URL(url).pathname.split('/').pop() || `dxvk-${DXVK_VERSION}.tar.gz`))
  const licenseFile = join(opts.cacheDir, `dxvk-${DXVK_VERSION}-${DXVK_LICENSE_FILE}`)

  let downloaded = false
  for (const [from, to] of [
    [url, tarball],
    [licenseUrl, licenseFile],
  ] as const) {
    if (opts.refresh || !existsSync(to)) {
      log(`downloading ${from}`)
      await download(from, to, fetchImpl)
      downloaded = true
    } else {
      log(`using cached ${to}`)
    }
  }

  const staged = await stageDxvk({ tarball, licenseFile, stageDir: opts.stageDir, pin })
  log(`staged ${staged.dll} (sha256 ${staged.sha256}) and ${staged.license}`)
  return { ...staged, tarball, downloaded }
}

/** Streams the response to `dest` through a `.part` file, so a failed download leaves no archive behind. */
async function download(url: string, dest: string, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`GET ${url} → HTTP ${res.status}`)
  await mkdir(dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(tmp))
    await rename(tmp, dest)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

// CLI mode
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  const opt = (name: string, fallback: string): string => argOption(args, name, fallback)
  try {
    const result = await fetchDxvk({
      url: opt('url', DXVK_RELEASE_URL),
      licenseUrl: opt('license-url', DXVK_LICENSE_URL),
      cacheDir: resolve(opt('cache', defaultCacheDir())),
      stageDir: resolve(opt('out', DEFAULT_STAGE_DIR)),
      refresh: args.includes('--refresh'),
    })
    console.log(`DXVK ${DXVK_VERSION}: ${result.downloaded ? 'downloaded' : 'cached'} ${result.tarball}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
