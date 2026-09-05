import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDevServer, type DevServer } from '../../../tools/dev-server'
import {
  downloadAll,
  ensureDiskSpace,
  type DownloadJob,
  type DownloadProgress,
} from '../src/main/download'

const FILE = '234930_001001.ipf'

let serverRoot: string
let destDir: string
let server: DevServer
let content: Buffer
let sha: string

beforeEach(async () => {
  serverRoot = await mkdtemp(join(tmpdir(), 'yufa-srv-'))
  destDir = await mkdtemp(join(tmpdir(), 'yufa-dst-'))
  content = randomBytes(512 * 1024)
  sha = createHash('sha256').update(content).digest('hex')
  await writeFile(join(serverRoot, FILE), content)
  server = await createDevServer({ root: serverRoot })
})

afterEach(async () => {
  await server.close()
})

function job(over: Partial<DownloadJob> = {}): DownloadJob {
  return { url: `${server.url}/${FILE}`, destDir, name: FILE, size: content.length, sha256: sha, ...over }
}

const fastOpts = { retries: 5, backoffMs: () => 1, progressIntervalMs: 5 }

describe('downloadAll', () => {
  it('downloads, verifies and finalizes a file, emitting progress', async () => {
    const events: DownloadProgress[] = []
    await downloadAll([job()], { ...fastOpts, onProgress: (p) => events.push(p) })

    expect((await readFile(join(destDir, FILE))).equals(content)).toBe(true)
    expect(existsSync(join(destDir, `${FILE}.part`))).toBe(false)
    expect(events.length).toBeGreaterThan(0)
    expect(events.some((e) => e.fileBytes > 0)).toBe(true)
    const last = events[events.length - 1]!
    expect(last.overallBytes).toBe(content.length)
    expect(last.overallTotal).toBe(content.length)
  })

  it('resumes with a Range request after the connection dies mid-download', async () => {
    server.killAfter(100 * 1024)
    await downloadAll([job()], fastOpts)

    expect((await readFile(join(destDir, FILE))).equals(content)).toBe(true)
    const ranged = server.requests.filter((r) => r.range)
    expect(ranged.length).toBeGreaterThanOrEqual(1)
    expect(ranged[0]!.range).toMatch(/^bytes=\d+-$/)
    expect(ranged[0]!.status).toBe(206)
  })

  it('resumes from a pre-existing .part file', async () => {
    await writeFile(join(destDir, `${FILE}.part`), content.subarray(0, 200 * 1024))
    await downloadAll([job()], fastOpts)

    expect((await readFile(join(destDir, FILE))).equals(content)).toBe(true)
    expect(server.requests[0]!.range).toBe(`bytes=${200 * 1024}-`)
  })

  it('restarts from zero when the server ignores Range', async () => {
    server.setIgnoreRange(true)
    await writeFile(join(destDir, `${FILE}.part`), content.subarray(0, 100))
    await downloadAll([job()], fastOpts)

    expect((await readFile(join(destDir, FILE))).equals(content)).toBe(true)
  })

  it('discards a corrupted download and succeeds on retry', async () => {
    server.corruptNext(FILE)
    await downloadAll([job()], fastOpts)

    expect((await readFile(join(destDir, FILE))).equals(content)).toBe(true)
    expect(server.requests.length).toBe(2)
  })

  it('fails fast with not-found on 404 without retrying', async () => {
    await expect(
      downloadAll([job({ url: `${server.url}/missing.ipf`, name: 'missing.ipf' })], fastOpts),
    ).rejects.toMatchObject({ code: 'not-found', retryable: false })
    expect(server.requests.length).toBe(1)
  })

  it('gives up after retries when the hash never matches', async () => {
    await expect(
      downloadAll([job({ sha256: 'f'.repeat(64) })], { ...fastOpts, retries: 2 }),
    ).rejects.toMatchObject({ code: 'corrupt' })
    expect(server.requests.length).toBe(3) // initial attempt + 2 retries
  })

  it('abort keeps the .part file for a later resume', async () => {
    const throttled = await createDevServer({ root: serverRoot, throttleBytesPerSec: 256 * 1024 })
    try {
      const ac = new AbortController()
      const promise = downloadAll([job({ url: `${throttled.url}/${FILE}` })], {
        ...fastOpts,
        signal: ac.signal,
      })
      setTimeout(() => ac.abort(), 150)
      await expect(promise).rejects.toMatchObject({ code: 'aborted' })

      const st = await stat(join(destDir, `${FILE}.part`))
      expect(st.size).toBeGreaterThan(0)
      expect(st.size).toBeLessThan(content.length)
    } finally {
      await throttled.close()
    }
  })

  it('reports overall progress across multiple files', async () => {
    const FILE2 = '234931_001001.ipf'
    const content2 = randomBytes(128 * 1024)
    await writeFile(join(serverRoot, FILE2), content2)

    const events: DownloadProgress[] = []
    await downloadAll(
      [
        job(),
        {
          url: `${server.url}/${FILE2}`,
          destDir,
          name: FILE2,
          size: content2.length,
          sha256: createHash('sha256').update(content2).digest('hex'),
        },
      ],
      { ...fastOpts, onProgress: (p) => events.push(p) },
    )

    const last = events[events.length - 1]!
    expect(last.overallBytes).toBe(content.length + content2.length)
    expect(last.overallTotal).toBe(content.length + content2.length)
    expect(existsSync(join(destDir, FILE2))).toBe(true)
  })
})

/**
 * In-process fetch stub with hand-driven response bodies: the test decides
 * when each file's bytes arrive, so completion order and in-flight state are
 * deterministic. Honours Range like R2 does.
 */
function stubFetch(files: Record<string, Buffer>) {
  const requests: { name: string; range: string | undefined }[] = []
  const open = new Map<string, { push(n: number): void; finish(): void }>()
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const name = url.slice(url.lastIndexOf('/') + 1)
    const range = (init?.headers as Record<string, string> | undefined)?.['Range']
    requests.push({ name, range })
    const content = files[name]
    if (!content) return new Response('not found', { status: 404 })
    const start = range ? Number(/^bytes=(\d+)-$/.exec(range)![1]) : 0
    const body = content.subarray(start)
    let sent = 0
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        ctrl = c
      },
      cancel: () => {
        open.delete(name)
      },
    })
    open.set(name, {
      push: (n) => {
        ctrl.enqueue(body.subarray(sent, sent + n))
        sent += n
      },
      finish: () => {
        ctrl.enqueue(body.subarray(sent))
        ctrl.close()
        open.delete(name)
      },
    })
    return new Response(stream, { status: start > 0 ? 206 : 200 })
  }) as typeof fetch
  return {
    fetchImpl,
    requests,
    inFlight: () => [...open.keys()].sort(),
    push: (name: string, n: number) => open.get(name)!.push(n),
    finish: (name: string) => open.get(name)!.finish(),
  }
}

describe('downloadAll with concurrency', () => {
  const A = '234930_001001.ipf'
  const B = '234931_001001.ipf'
  const C = '234932_001001.ipf'
  let files: Record<string, Buffer>

  beforeEach(() => {
    files = { [A]: randomBytes(4096), [B]: randomBytes(2048), [C]: randomBytes(1024) }
  })

  function stubJob(name: string): DownloadJob {
    return {
      url: `http://stub.invalid/${name}`,
      destDir,
      name,
      size: files[name]!.length,
      sha256: createHash('sha256').update(files[name]!).digest('hex'),
    }
  }

  it('keeps at most `concurrency` files in flight', async () => {
    const stub = stubFetch(files)
    const run = downloadAll([stubJob(A), stubJob(B), stubJob(C)], {
      ...fastOpts,
      fetchImpl: stub.fetchImpl,
      concurrency: 2,
    })

    await vi.waitFor(() => expect(stub.requests.length).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(stub.inFlight()).toEqual([A, B])

    stub.finish(A)
    await vi.waitFor(() => expect(stub.requests.length).toBe(3))
    expect(stub.inFlight()).toEqual([B, C])

    stub.finish(B)
    stub.finish(C)
    await run
    expect(existsSync(join(destDir, C))).toBe(true)
  })

  it('fires onFileComplete once per file, after its rename, even when files finish out of order', async () => {
    const stub = stubFetch(files)
    const completed: { index: number; onDisk: boolean; partGone: boolean }[] = []
    const run = downloadAll([stubJob(A), stubJob(B)], {
      ...fastOpts,
      fetchImpl: stub.fetchImpl,
      concurrency: 2,
      onFileComplete: (job, index) => {
        completed.push({
          index,
          onDisk: existsSync(join(destDir, job.name)),
          partGone: !existsSync(join(destDir, `${job.name}.part`)),
        })
      },
    })

    await vi.waitFor(() => expect(stub.inFlight()).toEqual([A, B]))
    stub.finish(B)
    await vi.waitFor(() => expect(completed.length).toBe(1))
    stub.finish(A)
    await run

    expect(completed).toEqual([
      { index: 1, onDisk: true, partGone: true },
      { index: 0, onDisk: true, partGone: true },
    ])
  })

  it('aggregates progress across in-flight files and shows the most recently started one', async () => {
    const stub = stubFetch(files)
    const events: DownloadProgress[] = []
    const run = downloadAll([stubJob(A), stubJob(B)], {
      ...fastOpts,
      progressIntervalMs: 0,
      fetchImpl: stub.fetchImpl,
      concurrency: 2,
      onProgress: (p) => events.push(p),
    })

    await vi.waitFor(() => expect(stub.inFlight()).toEqual([A, B]))
    stub.push(A, 1000)
    await new Promise((r) => setTimeout(r, 20)) // two samples apart in time, so a rate exists
    stub.push(B, 500)
    await vi.waitFor(() => expect(events.at(-1)?.overallBytes).toBe(1500))
    expect(events.at(-1)).toMatchObject({
      file: B,
      fileIndex: 2,
      fileCount: 2,
      fileBytes: 500,
      fileTotal: 2048,
      overallTotal: 4096 + 2048,
    })
    expect(events.at(-1)!.bytesPerSec).toBeGreaterThan(0)
    expect(events.at(-1)!.etaSec).toBeGreaterThanOrEqual(0)

    stub.finish(A)
    stub.finish(B)
    await run
    expect(events.at(-1)).toMatchObject({ overallBytes: 4096 + 2048, fileIndex: 2 })
    const indexes = events.map((e) => e.fileIndex)
    expect(indexes).toEqual([...indexes].sort((x, y) => x - y))
  })

  it('abort with files in flight keeps every .part; the next run resumes each with Range', async () => {
    const stub = stubFetch(files)
    const ac = new AbortController()
    const run = downloadAll([stubJob(A), stubJob(B)], {
      ...fastOpts,
      fetchImpl: stub.fetchImpl,
      concurrency: 2,
      signal: ac.signal,
    })
    await vi.waitFor(() => expect(stub.inFlight()).toEqual([A, B]))
    stub.push(A, 1000)
    stub.push(B, 500)
    await vi.waitFor(async () => {
      expect((await stat(join(destDir, `${A}.part`))).size).toBe(1000)
      expect((await stat(join(destDir, `${B}.part`))).size).toBe(500)
    })
    ac.abort()
    await expect(run).rejects.toMatchObject({ code: 'aborted' })
    expect((await stat(join(destDir, `${A}.part`))).size).toBe(1000)
    expect((await stat(join(destDir, `${B}.part`))).size).toBe(500)

    const again = stubFetch(files)
    const run2 = downloadAll([stubJob(A), stubJob(B)], { ...fastOpts, fetchImpl: again.fetchImpl, concurrency: 2 })
    await vi.waitFor(() => expect(again.inFlight()).toEqual([A, B]))
    again.finish(A)
    again.finish(B)
    await run2
    expect([...again.requests].sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { name: A, range: 'bytes=1000-' },
      { name: B, range: 'bytes=500-' },
    ])
    expect((await readFile(join(destDir, A))).equals(files[A]!)).toBe(true)
    expect((await readFile(join(destDir, B))).equals(files[B]!)).toBe(true)
  })

  it('one failing file keeps already-completed files and leaves in-flight ones resumable', async () => {
    const stub = stubFetch(files)
    const completed: string[] = []
    const run = downloadAll([stubJob(A), stubJob(B), { ...stubJob(C), url: 'http://stub.invalid/missing.ipf' }], {
      ...fastOpts,
      fetchImpl: stub.fetchImpl,
      concurrency: 2,
      onFileComplete: (job) => {
        completed.push(job.name)
      },
    })
    await vi.waitFor(() => expect(stub.inFlight()).toEqual([A, B]))
    stub.push(B, 500)
    stub.finish(A) // C (404) starts in A's slot and fails fast
    await expect(run).rejects.toMatchObject({ code: 'not-found' })

    expect(completed).toEqual([A])
    expect(existsSync(join(destDir, A))).toBe(true)
    expect((await stat(join(destDir, `${B}.part`))).size).toBe(500)
    expect(existsSync(join(destDir, B))).toBe(false)
  })
})

describe('ensureDiskSpace', () => {
  it('passes for tiny requirements and throws disk-full for absurd ones', async () => {
    await ensureDiskSpace(destDir, 0)
    await expect(ensureDiskSpace(destDir, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({
      code: 'disk-full',
    })
  })
})
