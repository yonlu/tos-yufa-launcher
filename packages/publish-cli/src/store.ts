import { createReadStream, promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { PublishConfig } from './config'

export interface PutOptions {
  contentType?: string
  cacheControl?: string
}

export interface StoredObject {
  key: string
  size: number
}

export interface PublishStore {
  getText(key: string): Promise<string | null>
  /** Streams the file into the store; never holds the whole file in memory. */
  putFile(key: string, filePath: string, opts?: PutOptions): Promise<void>
  putText(key: string, text: string, opts?: PutOptions): Promise<void>
  head(key: string): Promise<{ size: number } | null>
  /** Every object whose key starts with `prefix`. */
  list(prefix: string): Promise<StoredObject[]>
  /** Removes one object; a missing key is not an error. */
  delete(key: string): Promise<void>
  describe(): string
}

/** Filesystem-backed store for --local-out mode and tests. Records put order in `ops` and deletes in `deleted`. */
export class LocalDirStore implements PublishStore {
  readonly ops: string[] = []
  readonly deleted: string[] = []

  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    return join(this.root, ...key.split('/'))
  }

  async getText(key: string): Promise<string | null> {
    try {
      return await fs.readFile(this.pathFor(key), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async putFile(key: string, filePath: string): Promise<void> {
    const dest = this.pathFor(key)
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.copyFile(filePath, dest)
    this.ops.push(key)
  }

  async putText(key: string, text: string): Promise<void> {
    const dest = this.pathFor(key)
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.writeFile(dest, text, 'utf8')
    this.ops.push(key)
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const st = await fs.stat(this.pathFor(key))
      return { size: st.size }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
        throw err
      }
      for (const e of entries) {
        const full = join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else if (e.isFile()) {
          const key = relative(this.root, full).split(/[\\/]/).join('/')
          if (key.startsWith(prefix)) out.push({ key, size: (await fs.stat(full)).size })
        }
      }
    }
    await walk(this.root)
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key)
    try {
      await fs.unlink(this.pathFor(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  describe(): string {
    return `local dir ${this.root}`
  }
}

/**
 * 64 MiB parts: 13 GB fits well under S3's 10 000-part limit, and each part
 * retries on its own. YUFA_PART_MIB / YUFA_UPLOAD_QUEUE tune part size and
 * how many parts are in flight, for links that misbehave under load.
 */
const MULTIPART_PART_SIZE = (Number(process.env['YUFA_PART_MIB']) || 64) * 1024 * 1024
const MULTIPART_QUEUE = Number(process.env['YUFA_UPLOAD_QUEUE']) || 4

/** Cloudflare R2 via its S3-compatible API. Credentials come only from env. */
export class R2Store implements PublishStore {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(cfg: PublishConfig) {
    const accessKeyId = process.env['R2_ACCESS_KEY_ID']
    const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY']
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set (or use --local-out/--dry-run)')
    }
    this.bucket = cfg.bucket
    this.client = new S3Client({
      region: 'auto',
      endpoint: cfg.endpoint,
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  async getText(key: string): Promise<string | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      return (await res.Body?.transformToString('utf8')) ?? null
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null
      throw err
    }
  }

  async putFile(key: string, filePath: string, opts?: PutOptions): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: opts?.contentType,
        CacheControl: opts?.cacheControl,
      },
      partSize: MULTIPART_PART_SIZE,
      queueSize: MULTIPART_QUEUE,
      leavePartsOnError: false,
    })
    await upload.done()
  }

  async putText(key: string, text: string, opts?: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: text,
        ContentType: opts?.contentType,
        CacheControl: opts?.cacheControl,
      }),
    )
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return { size: res.ContentLength ?? 0 }
    } catch (err) {
      const name = (err as { name?: string }).name
      if (name === 'NotFound' || name === 'NoSuchKey') return null
      throw err
    }
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = []
    let token: string | undefined
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      )
      for (const o of res.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 })
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (token)
    return out
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  describe(): string {
    return `R2 bucket ${this.bucket}`
  }
}

/** Passes reads through, logs writes instead of performing them. */
export class DryRunStore implements PublishStore {
  constructor(
    private readonly base: PublishStore,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  getText(key: string): Promise<string | null> {
    return this.base.getText(key)
  }

  head(key: string): Promise<{ size: number } | null> {
    return this.base.head(key)
  }

  list(prefix: string): Promise<StoredObject[]> {
    return this.base.list(prefix)
  }

  async putFile(key: string, filePath: string, opts?: PutOptions): Promise<void> {
    this.log(`[dry-run] would upload ${filePath} -> ${key} (${opts?.cacheControl ?? 'no cache-control'})`)
  }

  async putText(key: string, text: string, opts?: PutOptions): Promise<void> {
    this.log(`[dry-run] would write ${key} (${text.length} bytes, ${opts?.cacheControl ?? 'no cache-control'})`)
  }

  async delete(key: string): Promise<void> {
    this.log(`[dry-run] would delete ${key}`)
  }

  describe(): string {
    return `dry-run over ${this.base.describe()}`
  }
}

export const CACHE = {
  immutable: 'public, max-age=31536000, immutable',
  none: 'no-cache',
} as const

export const CONTENT_TYPES = {
  blob: 'application/octet-stream',
  json: 'application/json',
  yaml: 'text/yaml',
  binary: 'application/octet-stream',
} as const
