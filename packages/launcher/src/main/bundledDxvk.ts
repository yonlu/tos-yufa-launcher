import { join, resolve } from 'node:path'
import type { App } from 'electron'
import { DXVK_FILE, DXVK_LICENSE_FILE } from '@yufa/shared'

/**
 * Where the bundled Compatibility fix (ADR 0003) sits in each kind of run.
 * tools/fetch-dxvk.ts stages `d3d9.dll` and `LICENSE` into
 * packages/launcher/build/dxvk/; electron-builder ships that folder as
 * `resources/dxvk/` (electron-builder.yml, extraResources). Dev runs read the
 * staged folder straight from the repo; the E2E smoke runs the packaged app.
 */
export interface BundledDxvk {
  dir: string
  dll: string
  license: string
}

export interface BundledDxvkEnv {
  isPackaged: boolean
  /** Electron's `process.resourcesPath`. */
  resourcesPath: string
  /** The folder the main bundle runs from (`out/main` in dev). */
  mainDir: string
}

export function resolveBundledDxvk(env: BundledDxvkEnv): BundledDxvk {
  const dir = env.isPackaged ? join(env.resourcesPath, 'dxvk') : resolve(env.mainDir, '..', '..', 'build', 'dxvk')
  return { dir, dll: join(dir, DXVK_FILE), license: join(dir, DXVK_LICENSE_FILE) }
}

/** Absolute path of the bundled `d3d9.dll` for this run. Pass Electron's `app`; it is not imported here so tests can load the module under node. */
export function bundledDxvkPath(app: Pick<App, 'isPackaged'>): string {
  return resolveBundledDxvk({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: __dirname }).dll
}
