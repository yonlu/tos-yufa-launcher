import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { WalkedFile } from './tree'

export type HashFile = (path: string) => Promise<string>

export const sha256File: HashFile = async (path) => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

interface CacheEntry {
  size: number
  mtimeMs: number
  sha256: string
}

interface CacheFile {
  version: 1
  entries: Record<string, CacheEntry>
}

/**
 * Remembers file hashes keyed by game-relative path, size and mtime so a
 * repeat release of an unchanged 13 GB folder hashes nothing. Missing or
 * unreadable cache files are treated as empty.
 */
export class HashCache {
  private entries: Record<string, CacheEntry> = {}
  private hits = 0
  private misses = 0

  private constructor(private readonly path: string) {}

  static async load(path: string): Promise<HashCache> {
    const cache = new HashCache(path)
    try {
      const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<CacheFile>
      if (parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        cache.entries = parsed.entries
      }
    } catch {
      // absent or corrupt cache: start empty
    }
    return cache
  }

  /** Returns the cached hash for a file whose size and mtime match, otherwise hashes and remembers it. */
  async hash(file: WalkedFile, hashFile: HashFile): Promise<string> {
    const hit = this.entries[file.relPath]
    if (hit && hit.size === file.size && hit.mtimeMs === file.mtimeMs) {
      this.hits++
      return hit.sha256
    }
    this.misses++
    const sha256 = await hashFile(file.absPath)
    this.entries[file.relPath] = { size: file.size, mtimeMs: file.mtimeMs, sha256 }
    return sha256
  }

  get stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses }
  }

  async save(): Promise<void> {
    const file: CacheFile = { version: 1, entries: this.entries }
    await fs.mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(file), 'utf8')
    await fs.rename(tmp, this.path)
  }
}
