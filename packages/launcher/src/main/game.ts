import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { LaunchResult } from '@yufa/shared'
import type { GamePaths } from './localState'

const execFileAsync = promisify(execFile)

export async function isGameRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq Client_tos.exe', '/NH'])
    return stdout.toLowerCase().includes('client_tos.exe')
  } catch {
    return false
  }
}

/** Spawns the game detached with release\ as working dir; resolves once spawn is confirmed. */
export function launchGame(paths: GamePaths, launchArgs: string): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const args = launchArgs.split(/\s+/).filter(Boolean)
    let child
    try {
      child = spawn(paths.clientExe, args, {
        cwd: paths.releaseDir,
        detached: true,
        stdio: 'ignore',
      })
    } catch (err) {
      resolve({ ok: false, error: { code: 'bad-game-path', message: (err as Error).message } })
      return
    }
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
    child.once('error', (err) => {
      resolve({ ok: false, error: { code: 'bad-game-path', message: err.message } })
    })
  })
}
