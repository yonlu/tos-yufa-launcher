import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DXVK_FILE, DXVK_PREVIOUS_SHA256, DXVK_SHA256, type DxvkResult, type ErrorInfo } from '@yufa/shared'
import { sha256File } from './download'
import { gamePaths } from './localState'

/**
 * The Compatibility fix (CONTEXT.md, ADR 0003): DXVK's `d3d9.dll` placed
 * next to the client when the player switches it on. The switch is the only
 * state; this module makes the file follow it. It knows the file by content
 * hash alone and refuses to touch a `release/d3d9.dll` whose hash it does
 * not recognise, so a hand-installed ReShade or DXVK is never overwritten
 * or removed.
 *
 * No operation ever throws: every outcome is a DxvkResult the renderer can
 * show, and a failure is a warning next to Play, never a block on it.
 *
 * Ordering with the patcher: reconcile() is what the patcher calls on its
 * way to ready and up-to-date, so it runs inside the patcher's own run;
 * enable() and disable() come from the renderer and are refused while the
 * patcher is mid-run (`busy`), the way checkRuntimes() is ignored then. The
 * module also queues its own operations so two never overlap.
 */

export interface DxvkPins {
  /** SHA-256 of the bundled file; the only content enable() will install. */
  current: string
  /** Hashes from earlier launcher releases: still ours, so disable removes them and enable upgrades them. */
  previous: readonly string[]
}

export interface DxvkDeps {
  /** The game folder as configured right now; read on every operation so a folder change applies. */
  gameDir: () => string
  /** Absolute path of the bundled `d3d9.dll` (bundledDxvk.ts). */
  bundledDll: string
  /** The switch: Settings' amdCompatibilityEnabled. */
  flag: { get(): boolean; set(on: boolean): void }
  isGameRunning: () => Promise<boolean>
  /** The patcher is checking, installing, updating or repairing: enable and disable wait for the next click. */
  isPatcherBusy?: () => boolean
  /** Defaults to the pins in @yufa/shared; tests inject fake files. */
  pins?: DxvkPins
}

/** Temp name the bundled file is copied to before the rename; a leftover is swept by cleanupStaleParts like any other `.part`. */
const TEMP_SUFFIX = '.part'

export class Dxvk {
  private readonly pins: DxvkPins
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: DxvkDeps) {
    this.pins = deps.pins ?? { current: DXVK_SHA256, previous: DXVK_PREVIOUS_SHA256 }
  }

  /**
   * Places the fix and sets the switch. Absent: the bundled file is copied
   * in. Current pin: nothing to write. Previous pin: replaced by the current
   * one. Anything else: refused before writing, with the path; the switch
   * is not set.
   */
  enable(): Promise<DxvkResult> {
    return this.serialised(() => this.enableInternal({ refuseWhenBusy: true }))
  }

  /**
   * Clears the switch and removes the file when its hash is a pin the
   * launcher knows. A foreign file is left where it is and reported; an
   * absent one is nothing to do.
   */
  disable(): Promise<DxvkResult> {
    return this.serialised(async () => {
      const refusal = await this.refusal({ refuseWhenBusy: true })
      if (refusal) return this.failed(refusal)
      const target = this.target()
      try {
        const existing = await hashIfExists(target)
        if (existing !== null && !this.known(existing)) {
          this.deps.flag.set(false)
          return { outcome: 'foreign', enabled: false, error: { code: 'foreign-dll', message: target } }
        }
        if (existing !== null) await fs.rm(target, { force: true })
        this.deps.flag.set(false)
        return { outcome: existing === null ? 'absent' : 'removed', enabled: false }
      } catch (err) {
        return this.failed(fsError(err, target))
      }
    })
  }

  /**
   * Makes the file follow the switch: on, the same as enable() (a deleted or
   * quarantined file comes back, a previous pin is upgraded); off, nothing
   * to do and nothing to report. Called by the patcher on the way to ready
   * and up-to-date, and before the client is launched.
   */
  reconcile(): Promise<DxvkResult | undefined> {
    return this.serialised(async () => {
      if (!this.deps.flag.get()) return undefined
      return this.enableInternal({ refuseWhenBusy: false })
    })
  }

  private async enableInternal(opts: { refuseWhenBusy: boolean }): Promise<DxvkResult> {
    const refusal = await this.refusal(opts)
    if (refusal) return this.failed(refusal)
    const target = this.target()
    try {
      const existing = await hashIfExists(target)
      if (existing === this.pins.current) {
        this.deps.flag.set(true)
        return { outcome: 'present', enabled: true }
      }
      if (existing !== null && !this.known(existing)) {
        return { outcome: 'foreign', enabled: this.deps.flag.get(), error: { code: 'foreign-dll', message: target } }
      }
      const bundled = await hashIfExists(this.deps.bundledDll)
      if (bundled !== this.pins.current) {
        const why = bundled === null ? 'is missing' : `has hash ${bundled}, expected ${this.pins.current}`
        return this.failed({ code: 'dxvk-failed', message: `bundled ${DXVK_FILE} ${why} (${this.deps.bundledDll})` })
      }
      await this.place(target)
      this.deps.flag.set(true)
      return { outcome: existing === null ? 'installed' : 'upgraded', enabled: true }
    } catch (err) {
      return this.failed(fsError(err, target))
    }
  }

  /** Copy to a temp name in the same folder, then rename over: the target is never half-written. */
  private async place(target: string): Promise<void> {
    const tmp = `${target}${TEMP_SUFFIX}`
    try {
      await fs.copyFile(this.deps.bundledDll, tmp)
      await fs.rename(tmp, target)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
  }

  private async refusal(opts: { refuseWhenBusy: boolean }): Promise<ErrorInfo | null> {
    if (opts.refuseWhenBusy && this.deps.isPatcherBusy?.()) return { code: 'busy' }
    if (await this.deps.isGameRunning()) return { code: 'game-running' }
    return null
  }

  private failed(error: ErrorInfo): DxvkResult {
    return { outcome: 'failed', enabled: this.deps.flag.get(), error }
  }

  private known(hash: string): boolean {
    return hash === this.pins.current || this.pins.previous.includes(hash)
  }

  private target(): string {
    return join(gamePaths(this.deps.gameDir()).releaseDir, DXVK_FILE)
  }

  /** Runs `op` after every operation queued before it; a failure inside never poisons the queue. */
  private serialised<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op)
    this.queue = next.catch(() => {})
    return next
  }
}

/** SHA-256 of the file, or null when there is no such file. */
async function hashIfExists(path: string): Promise<string | null> {
  try {
    return await sha256File(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** A locked file (the client or an antivirus holding it) is reported as such; anything else as dxvk-failed. */
function fsError(err: unknown, target: string): ErrorInfo {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EPERM' || code === 'EBUSY') return { code: 'file-locked', message: target }
  return { code: 'dxvk-failed', message: (err as Error).message }
}
