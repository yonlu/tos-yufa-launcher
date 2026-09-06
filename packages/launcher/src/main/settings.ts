import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '@yufa/shared'

const DEFAULTS: Settings = {
  gamePath: '',
  language: 'pt-BR',
  launchArgs: '-SERVICE /S',
  afterLaunch: 'quit',
  downloadConcurrency: 2,
  allowOfflinePlay: true,
}

/** Tiny synchronous JSON settings store (userData/config.json), atomic writes. */
export class SettingsStore {
  private readonly file: string
  private value: Settings

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'config.json')
    this.value = { ...DEFAULTS }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>
      this.value = this.sanitize({ ...DEFAULTS, ...raw })
    } catch {
      // first run or corrupt file — defaults stand
    }
  }

  get(): Settings {
    return { ...this.value }
  }

  set(partial: Partial<Settings>): Settings {
    this.value = this.sanitize({ ...this.value, ...partial })
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch {
      // settings persistence must never crash the launcher
    }
    return this.get()
  }

  private sanitize(s: Settings): Settings {
    return {
      gamePath: typeof s.gamePath === 'string' ? s.gamePath : '',
      language: s.language === 'en' ? 'en' : 'pt-BR',
      launchArgs: typeof s.launchArgs === 'string' ? s.launchArgs : DEFAULTS.launchArgs,
      afterLaunch: ['quit', 'minimize', 'stay'].includes(s.afterLaunch) ? s.afterLaunch : 'quit',
      downloadConcurrency: [1, 2, 3].includes(s.downloadConcurrency) ? s.downloadConcurrency : DEFAULTS.downloadConcurrency,
      allowOfflinePlay: s.allowOfflinePlay !== false,
    }
  }
}
