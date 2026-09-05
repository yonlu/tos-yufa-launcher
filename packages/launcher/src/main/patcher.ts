import { basename, dirname } from 'node:path'
import { promises as fs } from 'node:fs'
import semver from 'semver'
import {
  computePlan,
  emptyInstallRecord,
  manifestSchema,
  orderDownloads,
  patchArchiveRevision,
  type ErrorInfo,
  type InstallPlan,
  type InstallRecord,
  type Manifest,
  type ManifestFile,
  type PatcherProgressEvent,
  type PatcherStateEvent,
  type PlanSummary,
  withInstalledFile,
  withoutFile,
  withSeeded,
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
  absoluteGamePath,
  deleteGameFile,
  gamePaths,
  hasClientExe,
  readInstallRecord,
  readLocalRevision,
  scanLocalFiles,
  statGameFile,
  writeInstallRecord,
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
  /** Read at the start of every update so a settings change applies to the next run. */
  downloadConcurrency?: () => number
  manifestTimeoutMs?: number
}

class PatcherError extends Error {
  constructor(readonly info: ErrorInfo) {
    super(info.message ?? info.code)
    this.name = 'PatcherError'
  }
}

/** Everything a check learned: what is current, what is installed, what remains. */
interface Situation {
  manifest: Manifest
  record: InstallRecord | null
  plan: InstallPlan
  localRevision: number | null
  /** No Install Record and no client executable: nothing to update, only to install. */
  notInstalled: boolean
}

/**
 * State machine: idle → checking → not-installed | up-to-date | update-available
 *                → installing | updating (progress) → verifying → ready | error(code)
 * repair(): checking → repairing(hash progress) → same update path.
 *
 * The Current Manifest is authoritative; the Install Record is the local
 * memory of what was installed and is rewritten after every completed file,
 * so an interrupted install or update resumes from the next check.
 * release.revision.txt names the highest Patch archive with no gap below it.
 */
export class Patcher {
  private readonly paths: GamePaths
  private situation: Situation | null = null
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
    return this.situation?.manifest ?? null
  }

  async check(): Promise<PatcherStateEvent> {
    this.desyncRetried = false
    return this.checkInternal()
  }

  private async checkInternal(): Promise<PatcherStateEvent> {
    this.setState({ state: 'checking' })
    let situation: Situation
    try {
      situation = await this.assess(await this.fetchManifest())
    } catch (err) {
      return this.fail(err instanceof PatcherError ? err.info : { code: 'offline', message: (err as Error).message })
    }
    return this.settle(situation)
  }

  private async assess(manifest: Manifest, hashed?: ReadonlyMap<string, string>): Promise<Situation> {
    const [record, localRevision] = await Promise.all([readInstallRecord(this.paths), readLocalRevision(this.paths)])
    const local = await scanLocalFiles(
      this.paths,
      new Set([...manifest.files.map((f) => f.path), ...(record?.files.map((f) => f.path) ?? [])]),
    )
    const plan = computePlan({
      manifest,
      record,
      local,
      hashed: hashed ?? (record ? await this.hashUnrecorded(manifest, record, local) : undefined),
    })
    return { manifest, record, plan, localRevision, notInstalled: !record && !(await hasClientExe(this.paths)) }
  }

  /**
   * A crash between a file's rename and the record write leaves a complete
   * file the record does not know. Hashing such files (at most a handful:
   * one per download slot) is far cheaper than fetching them again.
   */
  private async hashUnrecorded(
    manifest: Manifest,
    record: InstallRecord,
    local: ReadonlyMap<string, { size: number }>,
  ): Promise<Map<string, string>> {
    const recorded = new Set(record.files.map((f) => f.path))
    const hashed = new Map<string, string>()
    for (const f of manifest.files) {
      if (f.class !== 'managed' || recorded.has(f.path) || local.get(f.path)?.size !== f.size) continue
      hashed.set(f.path, await sha256File(absoluteGamePath(this.paths, f.path)))
    }
    return hashed
  }

  /** Publishes what a check found, healing the two files a complete install may have drifted on. */
  private async settle(situation: Situation): Promise<PatcherStateEvent> {
    this.situation = situation
    const { plan, localRevision, notInstalled } = situation
    const summary = this.summary(plan, localRevision)
    if (notInstalled) return this.setState({ state: 'not-installed', plan: summary })
    if (!plan.toDownload.length && !plan.toSeed.length && !plan.toDelete.length) {
      if (localRevision !== plan.targetRevision) await writeLocalRevision(this.paths, plan.targetRevision)
      if (situation.record && !situation.record.completed) {
        await writeInstallRecord(this.paths, { ...situation.record, completed: true })
      }
      return this.setState({ state: 'up-to-date', plan: summary })
    }
    return this.setState({ state: 'update-available', plan: summary })
  }

  /** First-time install of the Current Manifest into the (possibly empty) game folder. */
  async install(): Promise<PatcherStateEvent> {
    return this.apply('installing')
  }

  async update(): Promise<PatcherStateEvent> {
    return this.apply('updating')
  }

  private async apply(state: 'installing' | 'updating'): Promise<PatcherStateEvent> {
    const situation = this.situation
    if (!situation) {
      return this.fail({ code: 'download-failed', message: `internal: ${state} without a plan` })
    }
    if (await this.deps.isGameRunning?.()) {
      return this.fail({ code: 'game-running' })
    }
    const { manifest, plan } = situation
    const summary = this.summary(plan, situation.localRevision)

    this.abort = new AbortController()
    this.setState({ state, plan: summary })
    try {
      await fs.mkdir(this.paths.gameDir, { recursive: true })
      await ensureDiskSpace(this.paths.gameDir, plan.totalBytes)

      // The record targets this Build from now on; it is complete only at the end.
      let record: InstallRecord = situation.record
        ? { ...situation.record, build: manifest.build, completed: false }
        : emptyInstallRecord(manifest.build)
      await writeInstallRecord(this.paths, record)

      for (const path of plan.toDelete) {
        try {
          await deleteGameFile(this.paths, path)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'EPERM' || code === 'EBUSY') throw new PatcherError({ code: 'file-locked', message: path })
          throw err
        }
        record = withoutFile(record, path)
        await writeInstallRecord(this.paths, record)
      }

      const entries = orderDownloads([...plan.toDownload, ...plan.toSeed])
      const jobs: DownloadJob[] = []
      for (const f of entries) {
        const dest = absoluteGamePath(this.paths, f.path)
        await fs.mkdir(dirname(dest), { recursive: true })
        jobs.push({
          url: manifest.blobBaseUrl + f.sha256,
          destDir: dirname(dest),
          name: basename(dest),
          size: f.size,
          sha256: f.sha256,
        })
      }

      const revisionReached = this.revisionTracker(manifest, entries)
      await downloadAll(jobs, {
        ...this.deps.engineOptions,
        fetchImpl: this.deps.fetchImpl ?? this.deps.engineOptions?.fetchImpl,
        concurrency: this.deps.downloadConcurrency?.() ?? this.deps.engineOptions?.concurrency,
        signal: this.abort.signal,
        onProgress: (p) => this.deps.onProgress?.({ phase: 'downloading', ...p }),
        onFileComplete: async (_job, index) => {
          const entry = entries[index]!
          record = await this.recordCompleted(record, entry)
          const rev = revisionReached(entry)
          if (rev !== null) await writeLocalRevision(this.paths, rev)
        },
      })

      await writeLocalRevision(this.paths, plan.targetRevision)

      this.setState({ state: 'verifying' })
      const problems = await this.quickVerify(manifest)
      if (problems.length) {
        return this.fail({ code: 'download-failed', message: `verification failed: ${problems.join('; ')}` })
      }
      await writeInstallRecord(this.paths, { ...record, completed: true })
      this.situation = null
      return this.setState({ state: 'ready', plan: summary })
    } catch (err) {
      return this.handleUpdateError(err, state)
    } finally {
      this.abort = null
    }
  }

  /** Adds a freshly renamed file to the record and persists it, so a crash right after loses nothing. */
  private async recordCompleted(record: InstallRecord, entry: ManifestFile): Promise<InstallRecord> {
    let next: InstallRecord
    if (entry.class === 'seed-once') {
      next = withSeeded(record, entry.path)
    } else {
      const st = await statGameFile(this.paths, entry.path)
      next = withInstalledFile(record, { path: entry.path, size: st.size, mtimeMs: st.mtimeMs, sha256: entry.sha256 })
    }
    if (next !== record) await writeInstallRecord(this.paths, next)
    return next
  }

  /**
   * Files may complete out of order. Given a just-completed file, returns
   * the revision the revision file may now name — the highest manifest
   * archive with every lower archive either already installed or completed
   * in this run — or null when nothing changed.
   */
  private revisionTracker(
    manifest: Manifest,
    entries: readonly ManifestFile[],
  ): (done: ManifestFile) => number | null {
    const pending = new Set(entries.map((f) => f.path).filter((p) => patchArchiveRevision(p) !== null))
    const archives = manifest.files
      .filter((f) => patchArchiveRevision(f.path) !== null)
      .sort((a, b) => patchArchiveRevision(a.path)! - patchArchiveRevision(b.path)!)
    let written = 0 // nothing to say until the lowest pending archive lands
    return (done) => {
      if (!pending.delete(done.path)) return null
      let reach = 0
      for (const a of archives) {
        if (pending.has(a.path)) break
        reach = patchArchiveRevision(a.path)!
      }
      if (reach === written) return null
      written = reach
      return reach
    }
  }

  /** Deep verification: re-hash every Managed File present locally, then heal. */
  async repair(): Promise<PatcherStateEvent> {
    this.desyncRetried = false
    this.setState({ state: 'checking' })
    let manifest: Manifest
    try {
      manifest = await this.fetchManifest()
    } catch (err) {
      return this.fail(err instanceof PatcherError ? err.info : { code: 'offline', message: (err as Error).message })
    }

    const managed = manifest.files.filter((f) => f.class === 'managed')
    const local = await scanLocalFiles(this.paths, managed.map((f) => f.path))
    const candidates = managed.filter((f) => local.get(f.path)?.size === f.size)
    const overallTotal = candidates.reduce((s, f) => s + f.size, 0)
    let overallBytes = 0
    const hashed = new Map<string, string>()

    this.abort = new AbortController()
    this.setState({ state: 'repairing' })
    try {
      for (const [i, f] of candidates.entries()) {
        if (this.abort.signal.aborted) return this.setState({ state: 'idle' })
        this.deps.onProgress?.({
          phase: 'hashing',
          file: f.path,
          fileIndex: i + 1,
          fileCount: candidates.length,
          fileBytes: 0,
          fileTotal: f.size,
          overallBytes,
          overallTotal,
          bytesPerSec: 0,
          etaSec: null,
        })
        hashed.set(f.path, await sha256File(absoluteGamePath(this.paths, f.path)))
        overallBytes += f.size
      }
    } finally {
      this.abort = null
    }

    const after = await this.settle(await this.assess(manifest, hashed))
    return after.state === 'update-available' ? this.update() : after
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

  /** Every Managed File exists with the manifest's size and the revision file agrees. */
  private async quickVerify(manifest: Manifest): Promise<string[]> {
    const managed = manifest.files.filter((f) => f.class === 'managed')
    const local = await scanLocalFiles(this.paths, managed.map((f) => f.path))
    const problems: string[] = []
    for (const f of managed) {
      const st = local.get(f.path)
      if (!st) problems.push(`${f.path} missing`)
      else if (st.size !== f.size) problems.push(`${f.path} has ${st.size} bytes, expected ${f.size}`)
    }
    const revision = await readLocalRevision(this.paths)
    if (revision !== manifest.revision) problems.push(`revision file says ${revision}, expected ${manifest.revision}`)
    return problems
  }

  private async handleUpdateError(err: unknown, state: 'installing' | 'updating'): Promise<PatcherStateEvent> {
    if (err instanceof PatcherError) return this.fail(err.info)
    if (err instanceof DownloadError) {
      switch (err.code) {
        case 'aborted':
          this.situation = null
          return this.setState({ state: 'idle' })
        case 'not-found': {
          // publish race: manifest listed a Blob the CDN doesn't have yet — re-check once
          if (!this.desyncRetried) {
            this.desyncRetried = true
            const after = await this.checkInternal()
            if (after.state === 'update-available') return this.apply(state)
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

  private summary(plan: InstallPlan, localRevision: number | null): PlanSummary {
    return {
      fileCount: plan.toDownload.length + plan.toSeed.length,
      deleteCount: plan.toDelete.length,
      totalBytes: plan.totalBytes,
      targetRevision: plan.targetRevision,
      localRevision: localRevision ?? 0,
    }
  }

  private async offlinePlayable(): Promise<boolean> {
    const record = await readInstallRecord(this.paths)
    return record?.completed === true
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
