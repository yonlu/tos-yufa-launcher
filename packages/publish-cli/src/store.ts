import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { PublishConfig } from './config'

export interface PutOptions {
  contentType?: string
  cacheControl?: string
}

export interface PatchStore {
  getText(key: string): Promise<string | null>
  putFile(key: string, filePath: string, opts?: PutOptions): Promise<void>
  putText(key: string, text: string, opts?: PutOptions): Promise<void>
  head(key: string): Promise<{ size: number } | null>
  describe(): string
}

/** Filesystem-backed store for --local-out mode and tests. Records put order in `ops`. */
export class LocalDirStore implements PatchStore {
  readonly ops: string[] = []

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

  describe(): string {
    return `local dir ${this.root}`
  }
}

/** Cloudflare R2 via its S3-compatible API. Credentials come only from env. */
export class R2Store implements PatchStore {
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
    const body = await fs.readFile(filePath)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts?.contentType,
        CacheControl: opts?.cacheControl,
      }),
    )
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

  describe(): string {
    return `R2 bucket ${this.bucket}`
  }
}

/** Passes reads through, logs writes instead of performing them. */
export class DryRunStore implements PatchStore {
  constructor(
    private readonly base: PatchStore,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  getText(key: string): Promise<string | null> {
    return this.base.getText(key)
  }

  head(key: string): Promise<{ size: number } | null> {
    return this.base.head(key)
  }

  async putFile(key: string, filePath: string, opts?: PutOptions): Promise<void> {
    this.log(`[dry-run] would upload ${filePath} -> ${key} (${opts?.cacheControl ?? 'no cache-control'})`)
  }

  async putText(key: string, text: string, opts?: PutOptions): Promise<void> {
    this.log(`[dry-run] would write ${key} (${text.length} bytes, ${opts?.cacheControl ?? 'no cache-control'})`)
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
  ipf: 'application/octet-stream',
  json: 'application/json',
  yaml: 'text/yaml',
  binary: 'application/octet-stream',
} as const
