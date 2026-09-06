import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { LaunchResult } from '@yufa/shared'
import type { GamePaths } from './localState'
import { psQuote } from './powershell'

const execFileAsync = promisify(execFile)

export async function isGameRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq Yuka.exe', '/NH'])
    return stdout.toLowerCase().includes('yuka.exe')
  } catch {
    return false
  }
}

/**
 * The client's manifest demands administrator, so a plain spawn fails with
 * EACCES (ERROR_ELEVATION_REQUIRED). Relaunch through ShellExecute's runas
 * verb so the player gets the standard UAC prompt.
 */
function launchElevated(paths: GamePaths, args: string[]): Promise<LaunchResult> {
  const argList = args.length ? ` -ArgumentList ${args.map(psQuote).join(',')}` : ''
  const cmd = `Start-Process -FilePath ${psQuote(paths.clientExe)}${argList} -WorkingDirectory ${psQuote(paths.releaseDir)} -Verb RunAs`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], (err) => {
      if (err) resolve({ ok: false, error: { code: 'elevation-declined', message: err.message } })
      else resolve({ ok: true })
    })
  })
}

/** Spawns the game detached with release\ as working dir; resolves once spawn is confirmed. */
export function launchGame(paths: GamePaths, launchArgs: string): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const args = launchArgs.split(/\s+/).filter(Boolean)
    const failed = (err: Error) => {
      if (process.platform === 'win32' && (err as NodeJS.ErrnoException).code === 'EACCES') {
        resolve(launchElevated(paths, args))
        return
      }
      resolve({ ok: false, error: { code: 'bad-game-path', message: err.message } })
    }
    let child
    try {
      child = spawn(paths.clientExe, args, {
        cwd: paths.releaseDir,
        detached: true,
        stdio: 'ignore',
      })
    } catch (err) {
      failed(err as Error)
      return
    }
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
    child.once('error', failed)
  })
}
