import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import semver from 'semver'
import {
  computePlan,
  manifestSchema,
  parsePatchFileName,
  patchArchiveRevision,
  type ErrorInfo,
  type Manifest,
  type PatchEntry,
  type PatcherProgressEvent,
  type PatcherStateEvent,
  type PlanSummary,
  type UpdatePlan,
} from '@yufa/shared'
import {
  downloadAll,
  DownloadError,
  ensureDiskSpace,
  sha256File,
  type DownloadJob,
  type EngineOptions,
} from './download'
import {
  gamePaths,
  deletePatchFile,
  isValidGameDir,
  readLocalRevision,
  scanPatchDir,
  writeLocalRevision,
  type GamePaths,
} from './localState'

export interface PatcherDeps {
  gameDir: string
  manifestUrl: string
  launcherVersion: string
  fetchImpl?: typeof fetch
  isGameRunning?: () => Promise<boolean>
  onState?: (e: PatcherStateEvent) => void
  onProgress?: (e: PatcherProgressEvent) => void
  engineOptions?: Partial<EngineOptions>
  manifestTimeoutMs?: number
}

/**
 * The patch-only view of a v2 Manifest: its Patch archives, ascending by
 * revision. Everything else the Manifest lists is ignored until the
 * Install Record plan lands (issue #4).
 */
function patchEntries(manifest: Manifest): PatchEntry[] {
  const out: PatchEntry[] = []
  for (const f of manifest.files) {
    const revision = patchArchiveRevision(f.path)
    if (revision === null) continue
    out.push({ name: f.path.slice(f.path.lastIndexOf('/') + 1), revision, size: f.size, sha256: f.sha256 })
  }
  return out.sort((a, b) => a.revision - b.revision)
}

class PatcherError extends Error {
  constructor(readonly info: ErrorInfo) {
    super(info.message ?? info.code)
    this.name = 'PatcherError'
  }
}

/**
 * State machine: idle → checking → up-to-date | update-available
 *                → updating(progress) → verifying → ready | error(code)
 * repair(): checking → repairing(hash progress) → same update path.
 * The manifest is authoritative; release.revision.txt is advanced after
 * every completed file so an interruption always leaves a launchable game.
 */
export class Patcher {
  private readonly paths: GamePaths
  private manifest: Manifest | null = null
  private plan: UpdatePlan | null = null
  private abort: AbortController | null = null
  private desyncRetried = false
  private lastState: PatcherStateEvent = { state: 'idle' }

  constructor(private readonly deps: PatcherDeps) {
    this.paths = gamePaths(deps.gameDir)
  }

  get state(): PatcherStateEvent {
    return this.lastState
  }

  get loadedManifest(): Manifest | null {
    return this.manifest
  }

  async check(): Promise<PatcherStateEvent> {
    this.desyncRetried = false
    return this.checkInternal()
  }

  private async checkInternal(): Promise<PatcherStateEvent> {
    this.setState({ state: 'checking' })
    let manifest: Manifest
    try {
      manifest = await this.fetchManifest()
    } catch (err) {
      return this.fail(err instanceof PatcherError ? err.info : { code: 'offline', message: (err as Error).message })
    }

    const [localFiles, localRevision] = await Promise.all([
      scanPatchDir(this.paths),
      readLocalRevision(this.paths),
    ])
    const plan = computePlan({
      manifest: { files: patchEntries(manifest), revision: manifest.revision },
      localFiles,
      localRevision,
    })
    this.manifest = manifest
    this.plan = plan

    if (!plan.toDownload.length && !plan.toDelete.length) {
      if (localRevision !== plan.targetRevision) await writeLocalRevision(this.paths, plan.targetRevision)
      return this.setState({ state: 'up-to-date', plan: this.summary(plan) })
    }
    return this.setState({ state: 'update-available', plan: this.summary(plan) })
  }

  async update(): Promise<PatcherStateEvent> {
    const { manifest, plan } = this
    if (!manifest || !plan) {
      return this.fail({ code: 'download-failed', message: 'internal: update() called without a plan' })
    }
    if (await this.deps.isGameRunning?.()) {
      return this.fail({ code: 'game-running' })
    }

    this.abort = new AbortController()
    this.setState({ state: 'updating', plan: this.summary(plan) })
    try {
      await ensureDiskSpace(this.paths.patchDir, plan.totalBytes)

      for (const name of plan.toDelete) {
        try {
          await deletePatchFile(this.paths, name)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'EPERM' || code === 'EBUSY') throw new PatcherError({ code: 'file-locked', message: name })
          throw err
        }
      }

      const jobs: DownloadJob[] = plan.toDownload.map((f) => ({
        url: manifest.blobBaseUrl + f.sha256,
        destDir: this.paths.patchDir,
        name: f.name,
        size: f.size,
        sha256: f.sha256,
      }))
      await downloadAll(jobs, {
        ...this.deps.engineOptions,
        fetchImpl: this.deps.fetchImpl ?? this.deps.engineOptions?.fetchImpl,
        signal: this.abort.signal,
        onProgress: (p) => this.deps.onProgress?.({ phase: 'downloading', ...p }),
        onFileComplete: async (job) => {
          const rev = parsePatchFileName(job.name)
          if (rev !== null) await writeLocalRevision(this.paths, rev)
        },
      })

      await writeLocalRevision(this.paths, plan.targetRevision)

      this.setState({ state: 'verifying' })
      const problems = await this.quickVerify(manifest)
      if (problems.length) {
        return this.fail({ code: 'download-failed', message: `verification failed: ${problems.join('; ')}` })
      }
      this.plan = null
      return this.setState({ state: 'ready', plan: this.summary(plan) })
    } catch (err) {
      return this.handleUpdateError(err)
    } finally {
      this.abort = null
    }
  }

  /** Deep verification: re-hash every manifest file present locally, then heal. */
  async repair(): Promise<PatcherStateEvent> {
    this.desyncRetried = false
    this.setState({ state: 'checking' })
    let manifest: Manifest
    try {
      manifest = await this.fetchManifest()
    } catch (err) {
      return this.fail(err instanceof PatcherError ? err.info : { code: 'offline', message: (err as Error).message })
    }

    const [localFiles, localRevision] = await Promise.all([
      scanPatchDir(this.paths),
      readLocalRevision(this.paths),
    ])

    this.abort = new AbortController()
    this.setState({ state: 'repairing' })
    const candidates = patchEntries(manifest).filter((f) =>
      localFiles.some((l) => l.name === f.name && l.size === f.size),
    )
    const overallTotal = candidates.reduce((s, f) => s + f.size, 0)
    let overallBytes = 0
    const corruptNames = new Set<string>()
    try {
      for (const [i, f] of candidates.entries()) {
        if (this.abort.signal.aborted) return this.setState({ state: 'idle' })
        this.deps.onProgress?.({
          phase: 'hashing',
          file: f.name,
          fileIndex: i + 1,
          fileCount: candidates.length,
          fileBytes: 0,
          fileTotal: f.size,
          overallBytes,
          overallTotal,
          bytesPerSec: 0,
          etaSec: null,
        })
        if ((await sha256File(join(this.paths.patchDir, f.name))) !== f.sha256) corruptNames.add(f.name)
        overallBytes += f.size
      }
    } finally {
      this.abort = null
    }

    const plan = computePlan({
      manifest: { files: patchEntries(manifest), revision: manifest.revision },
      localFiles,
      localRevision,
      corruptNames,
    })
    this.manifest = manifest
    this.plan = plan

    if (!plan.toDownload.length && !plan.toDelete.length) {
      if (localRevision !== plan.targetRevision) await writeLocalRevision(this.paths, plan.targetRevision)
      return this.setState({ state: 'up-to-date', plan: this.summary(plan) })
    }
    return this.update()
  }

  cancel(): void {
    this.abort?.abort()
  }

  private async fetchManifest(): Promise<Manifest> {
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const sep = this.deps.manifestUrl.includes('?') ? '&' : '?'
    const url = `${this.deps.manifestUrl}${sep}t=${Date.now()}`
    let res: Response
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(this.deps.manifestTimeoutMs ?? 15000) })
    } catch (err) {
      throw new PatcherError({ code: 'offline', message: (err as Error).message })
    }
    if (!res.ok) throw new PatcherError({ code: 'offline', message: `manifest: HTTP ${res.status}` })

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new PatcherError({ code: 'manifest-invalid', message: 'manifest is not valid JSON' })
    }
    const parsed = manifestSchema.safeParse(json)
    if (!parsed.success) {
      throw new PatcherError({ code: 'manifest-invalid', message: parsed.error.issues[0]?.message })
    }
    const manifest = parsed.data
    if (
      semver.valid(manifest.minLauncherVersion) &&
      semver.lt(this.deps.launcherVersion, manifest.minLauncherVersion)
    ) {
      throw new PatcherError({
        code: 'launcher-outdated',
        message: `launcher ${this.deps.launcherVersion} < required ${manifest.minLauncherVersion}`,
      })
    }
    return manifest
  }

  private async quickVerify(manifest: Manifest): Promise<string[]> {
    const problems: string[] = []
    for (const f of patchEntries(manifest)) {
      const st = await fs.stat(join(this.paths.patchDir, f.name)).catch(() => null)
      if (!st) problems.push(`${f.name} missing`)
      else if (st.size !== f.size) problems.push(`${f.name} has ${st.size} bytes, expected ${f.size}`)
    }
    const revision = await readLocalRevision(this.paths)
    if (revision !== manifest.revision) problems.push(`revision file says ${revision}, expected ${manifest.revision}`)
    return problems
  }

  private async handleUpdateError(err: unknown): Promise<PatcherStateEvent> {
    if (err instanceof PatcherError) return this.fail(err.info)
    if (err instanceof DownloadError) {
      switch (err.code) {
        case 'aborted':
          this.plan = null
          return this.setState({ state: 'idle' })
        case 'not-found': {
          // publish race: manifest listed a file the CDN doesn't have yet — re-check once
          if (!this.desyncRetried) {
            this.desyncRetried = true
            const after = await this.checkInternal()
            if (after.state === 'update-available') return this.update()
            return after
          }
          return this.fail({ code: 'manifest-cdn-desync', message: err.message })
        }
        case 'file-locked':
          return this.fail({ code: 'file-locked', message: err.message })
        case 'disk-full':
          return this.fail({ code: 'disk-full', message: err.message })
        default:
          return this.fail({ code: 'download-failed', message: err.message })
      }
    }
    return this.fail({ code: 'download-failed', message: (err as Error).message })
  }

  private summary(plan: UpdatePlan): PlanSummary {
    return {
      fileCount: plan.toDownload.length,
      deleteCount: plan.toDelete.length,
      totalBytes: plan.totalBytes,
      targetRevision: plan.targetRevision,
      localRevision: plan.localRevision,
    }
  }

  private async offlinePlayable(): Promise<boolean> {
    return (await isValidGameDir(this.paths.gameDir)) && (await readLocalRevision(this.paths)) !== null
  }

  private async fail(info: ErrorInfo): Promise<PatcherStateEvent> {
    const offlinePlayable = info.code === 'offline' ? await this.offlinePlayable() : undefined
    return this.setState({ state: 'error', error: info, offlinePlayable })
  }

  private setState(e: PatcherStateEvent): PatcherStateEvent {
    this.lastState = e
    this.deps.onState?.(e)
    return e
  }
}
