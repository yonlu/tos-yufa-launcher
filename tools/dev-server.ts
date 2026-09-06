import { createReadStream, promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, normalize, resolve } from 'node:path'
import { argOption, isMainModule } from './cli'

/**
 * Static file server for local patch-flow testing: honors HTTP Range
 * (like R2/nginx), and offers fault injection — corrupt one byte of the
 * next response for a file, kill the connection after N bytes, ignore
 * Range headers (forces client restart-from-zero), throttle throughput.
 */

export interface ServedRequest {
  path: string
  range: string | undefined
  status: number
}

export interface DevServerOptions {
  root: string
  throttleBytesPerSec?: number
  port?: number
}

export interface DevServer {
  url: string
  requests: ServedRequest[]
  /** Flip one byte in the middle of the next response for this file (one-shot). */
  corruptNext(fileName: string): void
  /** Destroy the socket of the next file response after N bytes (one-shot). */
  killAfter(bytes: number): void
  /** When true, Range headers are ignored and full 200 responses are served. */
  setIgnoreRange(v: boolean): void
  close(): Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function createDevServer(opts: DevServerOptions): Promise<DevServer> {
  const root = resolve(opts.root)
  const requests: ServedRequest[] = []
  let corruptFile: string | null = null
  let killAfterBytes: number | null = null
  let ignoreRange = false

  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    const rel = normalize(urlPath).replace(/^[/\\]+/, '')
    const filePath = join(root, rel)
    const entry: ServedRequest = { path: urlPath, range: req.headers.range, status: 0 }
    requests.push(entry)

    if (!filePath.startsWith(root)) {
      entry.status = 403
      res.writeHead(403).end()
      return
    }

    let st
    try {
      st = await fs.stat(filePath)
    } catch {
      entry.status = 404
      res.writeHead(404).end('not found')
      return
    }

    let start = 0
    let end = st.size - 1
    let status = 200
    const range = ignoreRange ? undefined : req.headers.range
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range)
      if (m) {
        start = Number(m[1])
        if (m[2]) end = Number(m[2])
        if (start >= st.size) {
          entry.status = 416
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end()
          return
        }
        status = 206
      }
    }
    entry.status = status

    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Type': 'application/octet-stream',
    }
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
    res.writeHead(status, headers)

    const fileName = rel.split(/[\\/]/).pop()!
    const corruptAt = corruptFile === fileName ? Math.floor((end - start + 1) / 2) : -1
    if (corruptAt >= 0) corruptFile = null
    const killAt = killAfterBytes
    if (killAt !== null) killAfterBytes = null

    let sent = 0
    const rs = createReadStream(filePath, { start, end })
    for await (const chunk of rs) {
      const buf = Buffer.from(chunk as Buffer)
      if (corruptAt >= sent && corruptAt < sent + buf.length) buf[corruptAt - sent]! ^= 0xff

      if (killAt !== null && sent + buf.length >= killAt) {
        res.write(buf.subarray(0, Math.max(1, killAt - sent)))
        await sleep(30) // let the client consume what was sent before dropping the socket
        res.destroy()
        return
      }

      sent += buf.length
      if (!res.write(buf)) await new Promise((r) => res.once('drain', r))
      if (opts.throttleBytesPerSec) await sleep((buf.length / opts.throttleBytesPerSec) * 1000)
    }
    res.end()
  })

  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    corruptNext: (fileName) => {
      corruptFile = fileName
    },
    killAfter: (bytes) => {
      killAfterBytes = bytes
    },
    setIgnoreRange: (v) => {
      ignoreRange = v
    },
    close: () =>
      new Promise((r) => {
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
}

// CLI mode: npm run dev-server -- --root <dir> [--port 8787] [--throttle <bytes/s>]
if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2)
  const root = argOption(args, 'root', './patch-store')
  const throttle = argOption(args, 'throttle', '')
  const port = argOption(args, 'port', '')
  const server = await createDevServer({
    root,
    throttleBytesPerSec: throttle ? Number(throttle) : undefined,
    port: port ? Number(port) : undefined,
  })
  console.log(`dev patch server: ${server.url}  (root: ${resolve(root)})`)
  setInterval(() => {
    while (server.requests.length) {
      const r = server.requests.shift()!
      console.log(`${r.status} ${r.path}${r.range ? `  Range: ${r.range}` : ''}`)
    }
  }, 500)
}
