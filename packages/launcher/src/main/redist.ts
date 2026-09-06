import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  REDIST_RUNTIMES,
  redistIndexSchema,
  type ErrorInfo,
  type RedistIndex,
  type RedistRuntime,
  type RedistStatus,
} from '@yufa/shared'
import { downloadAll, type DownloadJob, type DownloadProgress, type EngineOptions } from './download'
import { psQuote } from './powershell'

/**
 * Redistributable flow (CONTEXT.md): after a fresh install, find out which
 * Windows runtimes the 32-bit client lacks, fetch their trimmed installers
 * from the bucket's `redist/` area, and run them silently under one UAC
 * prompt. The two things that touch the OS — the probe and the runner —
 * are injected, so the flow is testable with fakes; the Windows
 * implementations live at the bottom of this file.
 *
 * Every failure is reported as a warning status, never thrown: a runtime
 * hiccup must not block Play.
 */

/** Which runtimes are present (true) on this machine. */
export type RedistProbe = () => Promise<Record<RedistRuntime, boolean>>

export interface RedistInstaller {
  runtime: RedistRuntime
  /** Absolute path of the installer to execute. */
  exe: string
  args: string[]
  /** Exit codes that mean success (1638 = newer VC++ already installed, 3010 = reboot required). */
  okExitCodes: number[]
}

/** Executes the installers in order, elevated, in one UAC prompt. Throws on failure. */
export type RedistRunner = (installers: RedistInstaller[]) => Promise<void>

export class RedistError extends Error {
  constructor(
    readonly code: 'elevation-declined' | 'redist-failed',
    message: string,
  ) {
    super(message)
    this.name = 'RedistError'
  }
}

/** Silent flags and success codes per runtime. */
const INSTALLERS: Record<RedistRuntime, { args: string[]; okExitCodes: number[] }> = {
  vcredist: { args: ['/install', '/quiet', '/norestart'], okExitCodes: [0, 1638, 3010] },
  directx: { args: ['/silent'], okExitCodes: [0] },
}

export interface RedistFlowDeps {
  probe: RedistProbe
  runner: RedistRunner
  /** URL of `redist/index.json`; file URLs are resolved next to it. */
  indexUrl: string
  /** Scratch folder for the installers; created on demand and removed at the end. */
  tempDir: string
  fetchImpl?: typeof fetch
  engineOptions?: Partial<EngineOptions>
  /** Emitted as the flow moves from downloading to installing. */
  onStatus?: (s: RedistStatus) => void
  onProgress?: (p: DownloadProgress) => void
  indexTimeoutMs?: number
}

/**
 * Probes, then for the missing runtimes downloads their files (verified
 * by size and hash through the download engine) and runs the installers.
 * Returns a terminal status: present (nothing was missing), installed, or
 * failed with the reason as a warning.
 */
export async function ensureRedistributables(deps: RedistFlowDeps): Promise<RedistStatus> {
  let missing: RedistRuntime[] = []
  try {
    const present = await deps.probe()
    missing = REDIST_RUNTIMES.filter((rt) => !present[rt])
    if (!missing.length) return { status: 'present', missing: [] }

    deps.onStatus?.({ status: 'downloading', missing })
    const index = await fetchIndex(deps)
    const installers = await downloadRuntimes(deps, index, missing)
    deps.onStatus?.({ status: 'installing', missing })
    await deps.runner(installers)
    return { status: 'installed', missing }
  } catch (err) {
    return { status: 'failed', missing, error: asErrorInfo(err) }
  } finally {
    await fs.rm(deps.tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

function asErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof RedistError) return { code: err.code, message: err.message }
  return { code: 'redist-failed', message: (err as Error).message }
}

async function fetchIndex(deps: RedistFlowDeps): Promise<RedistIndex> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sep = deps.indexUrl.includes('?') ? '&' : '?'
  let res: Response
  try {
    res = await fetchImpl(`${deps.indexUrl}${sep}t=${Date.now()}`, {
      signal: AbortSignal.timeout(deps.indexTimeoutMs ?? 15000),
    })
  } catch (err) {
    throw new RedistError('redist-failed', `redist index: ${(err as Error).message}`)
  }
  if (!res.ok) throw new RedistError('redist-failed', `redist index: HTTP ${res.status}`)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new RedistError('redist-failed', 'redist index is not valid JSON')
  }
  const parsed = redistIndexSchema.safeParse(json)
  if (!parsed.success) {
    throw new RedistError('redist-failed', `redist index: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  }
  return parsed.data
}

/** Fetches every file of the missing runtimes into the temp area; returns the installers to run, in runtime order. */
async function downloadRuntimes(
  deps: RedistFlowDeps,
  index: RedistIndex,
  missing: readonly RedistRuntime[],
): Promise<RedistInstaller[]> {
  const baseUrl = deps.indexUrl.slice(0, deps.indexUrl.lastIndexOf('/') + 1)
  const jobs: DownloadJob[] = []
  const installers: RedistInstaller[] = []
  for (const rt of missing) {
    const set = index.runtimes[rt]
    for (const f of set.files) {
      const dest = join(deps.tempDir, ...f.path.split('/'))
      await fs.mkdir(dirname(dest), { recursive: true })
      jobs.push({ url: baseUrl + f.path, destDir: dirname(dest), name: basename(dest), size: f.size, sha256: f.sha256 })
    }
    installers.push({ runtime: rt, exe: join(deps.tempDir, ...set.entry.split('/')), ...INSTALLERS[rt] })
  }
  await downloadAll(jobs, {
    ...deps.engineOptions,
    fetchImpl: deps.fetchImpl ?? deps.engineOptions?.fetchImpl,
    onProgress: deps.onProgress,
  })
  return installers
}

// ---- Windows implementations ----

const RUNTIME_DLLS: Record<RedistRuntime, string> = {
  vcredist: 'vcruntime140.dll',
  directx: 'd3dx9_43.dll',
}

/**
 * The client is 32-bit, so its runtimes live in SysWOW64 on 64-bit Windows
 * (System32 on a 32-bit one). Detection is by DLL presence only.
 */
export async function probeWindowsRuntimes(
  systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows',
): Promise<Record<RedistRuntime, boolean>> {
  const wow = join(systemRoot, 'SysWOW64')
  const dir = (await fs.stat(wow).catch(() => null))?.isDirectory() ? wow : join(systemRoot, 'System32')
  const present = async (dll: string) => !!(await fs.stat(join(dir, dll)).catch(() => null))?.isFile()
  return { vcredist: await present(RUNTIME_DLLS.vcredist), directx: await present(RUNTIME_DLLS.directx) }
}

/**
 * The script the elevated PowerShell runs: each installer in turn, waited
 * on, its exit code judged against the accepted set and written to
 * `resultFile` (an elevated process cannot pipe output back through
 * Start-Process). Exits non-zero when any installer failed.
 */
export function elevatedRunScript(installers: readonly RedistInstaller[], resultFile: string): string {
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    '$failed = 0',
    `$result = ${psQuote(resultFile)}`,
    "Set-Content -Path $result -Value ''",
  ]
  for (const i of installers) {
    const args = i.args.length ? ` -ArgumentList ${i.args.map(psQuote).join(',')}` : ''
    lines.push(
      `$p = Start-Process -FilePath ${psQuote(i.exe)}${args} -Wait -PassThru`,
      `Add-Content -Path $result -Value "${i.runtime}=$($p.ExitCode)"`,
      `if (@(${i.okExitCodes.join(',')}) -notcontains $p.ExitCode) { $failed = 1 }`,
    )
  }
  lines.push('exit $failed')
  return lines.join('\r\n') + '\r\n'
}

/** ERROR_CANCELLED: the player refused the UAC prompt. */
const WIN32_ERROR_CANCELLED = 1223

/**
 * Runs the installers through one elevated PowerShell (a single UAC
 * prompt): writes the run script next to the installers, launches it with
 * the runas verb from a non-elevated PowerShell, and waits. A refused
 * prompt surfaces as elevation-declined; any failing installer as
 * redist-failed with the exit codes the script recorded.
 */
export async function runInstallersElevated(installers: RedistInstaller[]): Promise<void> {
  if (!installers.length) return
  const dir = dirname(installers[0]!.exe)
  const scriptFile = join(dir, 'run-redist.ps1')
  const resultFile = join(dir, 'run-redist.result.txt')
  await fs.writeFile(scriptFile, elevatedRunScript(installers, resultFile), 'utf8')

  const inner = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile]
  const outer = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    `  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList ${inner.map(psQuote).join(',')} -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
    '  if ($null -eq $p.ExitCode) { exit 1 }',
    '  exit $p.ExitCode',
    '} catch {',
    '  $e = $_.Exception',
    `  if ($e.NativeErrorCode -eq ${WIN32_ERROR_CANCELLED} -or $e.InnerException.NativeErrorCode -eq ${WIN32_ERROR_CANCELLED}) { exit ${WIN32_ERROR_CANCELLED} }`,
    '  Write-Error $e.Message',
    '  exit 1',
    '}',
  ].join('\n')

  const exitCode = await new Promise<number>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', outer], (err) => {
      if (!err) return resolve(0)
      const code = (err as { code?: unknown }).code
      if (typeof code === 'number') return resolve(code)
      reject(new RedistError('redist-failed', err.message))
    })
  })
  if (exitCode === 0) return
  if (exitCode === WIN32_ERROR_CANCELLED) {
    throw new RedistError('elevation-declined', 'the administrator prompt was declined')
  }
  const recorded = (await fs.readFile(resultFile, 'utf8').catch(() => '')).trim().split(/\r?\n/).filter(Boolean)
  throw new RedistError(
    'redist-failed',
    recorded.length ? `installer exit codes: ${recorded.join(', ')}` : `elevated run exited with ${exitCode}`,
  )
}
