import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'

const configSchema = z.object({
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  publicBaseUrl: z.string().url().endsWith('/'),
  manifestKey: z.string().min(1),
  patchesPrefix: z.string().endsWith('/'),
  newsKey: z.string().min(1),
  newsImagesPrefix: z.string().endsWith('/'),
  launcherPrefix: z.string().endsWith('/'),
  grandfatherRevision: z.number().int().nonnegative(),
})

export type PublishConfig = z.infer<typeof configSchema>

/** Loads publish.config.json from an explicit path, or walks up from cwd. */
export function loadConfig(explicitPath?: string): PublishConfig {
  let path = explicitPath
  if (!path) {
    let dir = resolve(process.cwd())
    for (;;) {
      const candidate = join(dir, 'publish.config.json')
      if (existsSync(candidate)) {
        path = candidate
        break
      }
      const parent = dirname(dir)
      if (parent === dir) throw new Error('publish.config.json not found (searched cwd and parents); pass --config')
      dir = parent
    }
  }
  return configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
