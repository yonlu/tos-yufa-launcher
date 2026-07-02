import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

describe('ensureDiskSpace', () => {
  it('passes for tiny requirements and throws disk-full for absurd ones', async () => {
    await ensureDiskSpace(destDir, 0)
    await expect(ensureDiskSpace(destDir, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({
      code: 'disk-full',
    })
  })
})
