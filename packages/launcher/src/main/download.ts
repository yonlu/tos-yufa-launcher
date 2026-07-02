import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Headless download engine: no Electron imports, fetch is injected
 * (Electron main passes net.fetch, tests pass Node's global fetch).
 */

export type DownloadErrorCode =
  | 'network'
  | 'http'
  | 'corrupt'
  | 'not-found'
  | 'forbidden'
  | 'file-locked'
  | 'disk-full'
  | 'aborted'

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly code: DownloadErrorCode,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

export interface DownloadJob {
  url: string
  destDir: string
  name: string
  size: number
  sha256: string
}

export interface DownloadProgress {
  file: string
  fileIndex: number
  fileCount: number
  fileBytes: number
  fileTotal: number
  overallBytes: number
  overallTotal: number
  bytesPerSec: number
  etaSec: number | null
}

export interface EngineOptions {
  fetchImpl?: typeof fetch
  retries?: number
  backoffMs?: (attempt: number) => number
  progressIntervalMs?: number
  onProgress?: (p: DownloadProgress) => void
  /** Awaited after each file is verified and renamed into place. */
  onFileComplete?: (job: DownloadJob, index: number) => void | Promise<void>
  signal?: AbortSignal
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await hashFileInto(hash, path)
  return hash.digest('hex')
}

function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string }
  return e?.name === 'AbortError' || e?.code === 'ABORT_ERR'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DownloadError('aborted', 'aborted', false))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DownloadError('aborted', 'aborted', false))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function hashFileInto(hash: Hash, path: string): Promise<void> {
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
}

class SpeedMeter {
  private samples: { t: number; n: number }[] = []

  add(n: number): void {
    const t = Date.now()
    this.samples.push({ t, n })
    const cutoff = t - 5000
    while (this.samples.length && this.samples[0]!.t < cutoff) this.samples.shift()
  }

  bytesPerSec(): number {
    if (this.samples.length < 2) return 0
    const first = this.samples[0]!
    const elapsed = (Date.now() - first.t) / 1000
    if (elapsed <= 0) return 0
    return this.samples.reduce((s, x) => s + x.n, 0) / elapsed
  }
}

interface AttemptReporter {
  reset(): void
  add(n: number, network: boolean): void
}

/** Frees `needed` bytes plus a 200 MB safety margin, or throws disk-full. */
export async function ensureDiskSpace(dir: string, needed: number): Promise<void> {
  const sf = await fs.statfs(dir)
  const free = Number(sf.bavail) * Number(sf.bsize)
  const required = needed + 200 * 1024 * 1024
  if (free < required) {
    throw new DownloadError(
      `need ${Math.ceil(required / 1e6)} MB free in ${dir}, only ${Math.floor(free / 1e6)} MB available`,
      'disk-full',
      false,
    )
  }
}

async function attemptOne(
  job: DownloadJob,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  report: AttemptReporter,
): Promise<void> {
  const partPath = join(job.destDir, `${job.name}.part`)
  const finalPath = join(job.destDir, job.name)
  report.reset()

  let hash = createHash('sha256')
  let offset = 0

  const st = await fs.stat(partPath).catch(() => null)
  if (st && st.size > 0) {
    if (st.size <= job.size) {
      await hashFileInto(hash, partPath)
      offset = st.size
      report.add(st.size, false)
    } else {
      await fs.rm(partPath, { force: true })
    }
  }

  if (offset < job.size) {
    const headers: Record<string, string> = {}
    if (offset > 0) headers['Range'] = `bytes=${offset}-`

    let res: Response
    try {
      res = await fetchImpl(job.url, { headers, signal })
    } catch (err) {
      if (isAbortError(err)) throw new DownloadError('aborted', 'aborted', false)
      throw new DownloadError(`network error fetching ${job.url}: ${(err as Error).message}`, 'network', true)
    }

    if (res.status === 404) throw new DownloadError(`${job.url}: not found`, 'not-found', false, 404)
    if (res.status === 403) throw new DownloadError(`${job.url}: forbidden`, 'forbidden', false, 403)
    if (res.status === 416) {
      await fs.rm(partPath, { force: true })
      throw new DownloadError(`${job.url}: range not satisfiable`, 'http', true, 416)
    }
    if (!res.ok) {
      throw new DownloadError(`${job.url}: HTTP ${res.status}`, 'http', res.status >= 500 || res.status === 429, res.status)
    }

    let flags = 'a'
    if (res.status === 200) {
      flags = 'w'
      if (offset > 0) {
        // server ignored our Range header — restart from zero
        offset = 0
        hash = createHash('sha256')
        report.reset()
      }
    }
    if (!res.body) throw new DownloadError(`${job.url}: empty response body`, 'network', true)

    const ws = createWriteStream(partPath, { flags })
    const tee = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk)
        report.add(chunk.length, true)
        cb(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(res.body as never), tee, ws, { signal })
    } catch (err) {
      if (isAbortError(err)) throw new DownloadError('aborted', 'aborted', false)
      throw new DownloadError(`stream error for ${job.name}: ${(err as Error).message}`, 'network', true)
    }
  }

  const finalSize = (await fs.stat(partPath)).size
  if (finalSize !== job.size) {
    if (finalSize > job.size) await fs.rm(partPath, { force: true })
    throw new DownloadError(`${job.name}: got ${finalSize} bytes, expected ${job.size}`, 'network', true)
  }
  if (hash.digest('hex') !== job.sha256) {
    await fs.rm(partPath, { force: true })
    throw new DownloadError(`${job.name}: sha256 mismatch`, 'corrupt', true)
  }

  try {
    await fs.rename(partPath, finalPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      throw new DownloadError(`${job.name} is locked (game or antivirus running?): ${code}`, 'file-locked', false)
    }
    throw err
  }
}

/**
 * Downloads jobs sequentially (ascending order is the caller's contract:
 * the patcher advances release.revision.txt after each completed file).
 * Each file: resume from .part via Range (prefix re-hashed into the same
 * digest), streaming sha256, atomic rename, retry with backoff.
 */
export async function downloadAll(jobs: DownloadJob[], opts: EngineOptions = {}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const retries = opts.retries ?? 5
  const backoff = opts.backoffMs ?? ((attempt) => 1000 * 2 ** (attempt - 1) + Math.random() * 500)
  const intervalMs = opts.progressIntervalMs ?? 250

  const overallTotal = jobs.reduce((s, j) => s + j.size, 0)
  const speed = new SpeedMeter()
  let overallBase = 0
  let fileBytes = 0
  let lastEmit = 0

  for (const [index, job] of jobs.entries()) {
    const emit = (force = false) => {
      const now = Date.now()
      if (!force && now - lastEmit < intervalMs) return
      lastEmit = now
      const overallBytes = overallBase + fileBytes
      const rate = speed.bytesPerSec()
      opts.onProgress?.({
        file: job.name,
        fileIndex: index + 1,
        fileCount: jobs.length,
        fileBytes,
        fileTotal: job.size,
        overallBytes,
        overallTotal,
        bytesPerSec: rate,
        etaSec: rate > 0 ? Math.round((overallTotal - overallBytes) / rate) : null,
      })
    }

    const report: AttemptReporter = {
      reset: () => {
        fileBytes = 0
        emit(true)
      },
      add: (n, network) => {
        fileBytes += n
        if (network) speed.add(n)
        emit()
      },
    }

    let attempt = 0
    for (;;) {
      if (opts.signal?.aborted) throw new DownloadError('aborted', 'aborted', false)
      try {
        await attemptOne(job, fetchImpl, opts.signal, report)
        break
      } catch (err) {
        const de =
          err instanceof DownloadError
            ? err
            : new DownloadError(`unexpected: ${(err as Error).message}`, 'network', true)
        if (!de.retryable || attempt >= retries) throw de
        attempt += 1
        await sleep(backoff(attempt), opts.signal)
      }
    }

    await opts.onFileComplete?.(job, index)
    overallBase += job.size
    fileBytes = 0
    emit(true)
  }
}
