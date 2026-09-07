import { spawn, spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { rollback } from '../packages/publish-cli/src/commands'
import { sha256File } from '../packages/publish-cli/src/hash'
import { manifestSchema, type Manifest } from '../packages/shared/src/index'
import { argOption } from './cli'
import { createDevServer } from './dev-server'
import { expectCompatibilityFix, expectReleaseMatchesRecord, readInstallRecord } from './e2e-checks'
import { buildSandbox, bumpSandbox, sandboxCtx, sandboxPaths } from './e2e-setup'

/**
 * Rehearses the whole pipeline against the PACKAGED launcher: install into an
 * empty folder, switch the Compatibility fix on, update to a bumped Build,
 * roll back, switch the fix off — each run captured by the screenshot smoke
 * hook and judged by what lands in the game folder. The runs with an AMD
 * adapter pretended (YUFA_GPU=amd) photograph the one-time prompt and the
 * Settings switch, in both languages between them.
 * Each `--*-delay` is the wait before that screenshot, in ms.
 *
 *   npm run dist                       # once: the packaged launcher under release-builds/win-unpacked
 *   npm run e2e -- [--base ./e2e-sandbox] [--exe <launcher exe>] [--port 8787] [--size 3000000] [--install-delay 12000]
 *
 * Screenshots go to <base>/shots. Every step must pass; the exit code says so.
 */

const args = process.argv.slice(2)
const opt = (name: string, fallback: string): string => argOption(args, name, fallback)

const base = resolve(opt('base', './e2e-sandbox'))
const port = Number(opt('port', '8787'))
const size = Number(opt('size', '3000000'))
/** How long each launcher run gets before the screenshot hook captures it and quits. */
const panelShotMs = Number(opt('panel-delay', '4500'))
const installShotMs = Number(opt('install-delay', '12000'))
const exe = resolve(opt('exe', join('packages', 'launcher', 'release-builds', 'win-unpacked', 'Yufa Launcher.exe')))
const url = `http://127.0.0.1:${port}/`

if (!existsSync(exe)) {
  console.error(`packaged launcher not found at ${exe} — run "npm run dist" first, or pass --exe`)
  process.exit(1)
}

// the launcher refuses to install or update while a Yuka.exe runs — any Yuka.exe, a leftover stand-in included
const running = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Yuka.exe', '/NH'], { encoding: 'utf8' })
if (running.stdout?.toLowerCase().includes('yuka.exe')) {
  console.warn('warning: a Yuka.exe is running; the launcher will report game-running instead of installing')
}

const paths = sandboxPaths(base)
const shotsDir = join(base, 'shots')
const userData = join(base, 'userdata')

await fs.rm(base, { recursive: true, force: true })
await fs.mkdir(shotsDir, { recursive: true })
const setup = await buildSandbox({ base, url, count: 2, size, log: () => {} })
console.log(`sandbox: build ${setup.build} published to ${paths.storeDir}`)

const server = await createDevServer({ root: paths.storeDir, port })
console.log(`dev server: ${server.url}`)

interface StepResult {
  name: string
  ok: boolean
  detail: string
}
const results: StepResult[] = []

async function runLauncher(name: string, env: Record<string, string>, delayMs: number): Promise<string> {
  const shot = join(shotsDir, `${name}.png`)
  await new Promise<void>((done, fail) => {
    const child = spawn(exe, [], {
      stdio: 'ignore',
      env: {
        ...process.env,
        YUFA_MANIFEST_URL: setup.manifestUrl,
        YUFA_GAME_DIR: paths.gameDir,
        YUFA_USERDATA: userData,
        YUFA_SCREENSHOT: shot,
        YUFA_SCREENSHOT_DELAY: String(delayMs),
        ...env,
      },
    })
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error(`launcher did not exit within ${delayMs + 30_000} ms`))
    }, delayMs + 30_000)
    child.once('error', (err) => {
      clearTimeout(timer)
      fail(err)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0 || code === null) done()
      else fail(new Error(`launcher exited with code ${code}`))
    })
  })
  if (!existsSync(shot)) throw new Error(`no screenshot at ${shot}`)
  return shot
}

/** The launcher reads userdata/config.json at start: set the language or the prompt flag for the next run. */
async function seedSettings(partial: Record<string, unknown>): Promise<void> {
  const file = join(userData, 'config.json')
  const current = existsSync(file) ? (JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>) : {}
  await fs.mkdir(userData, { recursive: true })
  await fs.writeFile(file, JSON.stringify({ ...current, ...partial }, null, 2))
}

/** The Compatibility fix switch as the launcher left it in userdata/config.json. */
async function fixSwitchInConfig(): Promise<boolean> {
  const config = JSON.parse(await fs.readFile(join(userData, 'config.json'), 'utf8')) as { amdCompatibilityEnabled?: boolean }
  return config.amdCompatibilityEnabled === true
}

async function currentManifest(): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await fs.readFile(join(paths.storeDir, 'manifest.json'), 'utf8')))
}

/** The game folder must hold exactly the current Build: record complete, every file present with the right hash, revision file right. */
async function expectInstalled(manifest: Manifest): Promise<void> {
  const record = await readInstallRecord(paths.gameDir)
  if (!record.completed) throw new Error('Install Record is not completed')
  if (record.build !== manifest.build) throw new Error(`Install Record says build ${record.build}, manifest is ${manifest.build}`)
  for (const f of manifest.files) {
    const local = join(paths.gameDir, ...f.path.split('/'))
    if (!existsSync(local)) throw new Error(`${f.path} missing from the game folder`)
    if (f.class === 'managed' && (await sha256File(local)) !== f.sha256) throw new Error(`${f.path} differs from the manifest`)
  }
  const revisionFile = join(paths.gameDir, 'release', 'release.revision.txt')
  const revision = Number((await fs.readFile(revisionFile, 'utf8')).trim())
  if (revision !== manifest.revision) throw new Error(`release.revision.txt says ${revision}, manifest revision is ${manifest.revision}`)
  if (existsSync(join(paths.gameDir, 'release', 'user.xml'))) throw new Error('release/user.xml leaked into the install')
}

async function step(name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run()
    results.push({ name, ok: true, detail })
    console.log(`ok   ${name}: ${detail}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ name, ok: false, detail })
    console.log(`FAIL ${name}: ${detail}`)
  }
}

try {
  await step('install panel on an empty folder', async () => {
    const shot = await runLauncher('1-install-panel', {}, panelShotMs)
    if ((await fs.readdir(paths.gameDir)).length) throw new Error('the launcher wrote into the game folder without being told to install')
    return shot
  })

  // an AMD adapter is pretended from here on: the first ready shows the one-time prompt (pt-BR)
  await step('install Build 1 (AMD prompt on first ready)', async () => {
    const shot = await runLauncher('2-installed-prompt-pt', { YUFA_AUTO: 'update', YUFA_GPU: 'amd' }, installShotMs)
    await expectInstalled(await currentManifest())
    await expectCompatibilityFix(paths.gameDir, 'absent')
    return shot
  })

  await step('enable the Compatibility fix', async () => {
    await seedSettings({ language: 'pt-BR', amdCompatibilityPrompted: true })
    const env = { YUFA_GPU: 'amd', YUFA_DXVK: 'enable', YUFA_VIEW: 'settings' }
    const shot = await runLauncher('3-fix-enabled-settings-pt', env, panelShotMs)
    if (!(await fixSwitchInConfig())) throw new Error('the switch is not on in config.json')
    await expectCompatibilityFix(paths.gameDir, 'present')
    await expectInstalled(await currentManifest())
    return shot
  })

  const build1 = await currentManifest()
  const bump = await bumpSandbox({ base, url, log: () => {} })
  await step(`update to Build ${bump.build} (${bump.changed} changed, ${bump.added} added); the fix survives`, async () => {
    await seedSettings({ language: 'en' })
    const env = { YUFA_AUTO: 'update', YUFA_GPU: 'amd', YUFA_VIEW: 'settings' }
    const shot = await runLauncher('4-updated-settings-en', env, installShotMs)
    await expectInstalled(await currentManifest())
    await expectCompatibilityFix(paths.gameDir, 'present')
    const record = await readInstallRecord(paths.gameDir)
    if (record.files.some((f) => f.path === 'release/d3d9.dll')) throw new Error('release/d3d9.dll entered the Install Record')
    return shot
  })

  await step('roll back to Build 1; the fix survives', async () => {
    await seedSettings({ language: 'pt-BR' })
    await rollback(sandboxCtx({ base, url, log: () => {} }), build1.build)
    const shot = await runLauncher('5-rolled-back-ready', { YUFA_AUTO: 'update' }, installShotMs)
    const manifest = await currentManifest()
    await expectInstalled(manifest)
    if (manifest.build !== build1.build) throw new Error(`rollback left build ${manifest.build} current`)
    if (existsSync(join(paths.gameDir, ...bump.added.split('/')))) throw new Error(`${bump.added} survived the rollback`)
    const restored = await sha256File(join(paths.gameDir, ...bump.changed.split('/')))
    if (restored !== build1.files.find((f) => f.path === bump.changed)?.sha256) {
      throw new Error(`${bump.changed} is not back to its Build 1 content`)
    }
    await expectCompatibilityFix(paths.gameDir, 'present')
    return shot
  })

  // switched off before the window opens; with the prompt flag cleared, ready shows the prompt again (en)
  await step('disable the Compatibility fix; release/ matches the Install Record', async () => {
    await seedSettings({ language: 'en', amdCompatibilityPrompted: false })
    const shot = await runLauncher('6-fix-disabled-prompt-en', { YUFA_GPU: 'amd', YUFA_DXVK: 'disable' }, panelShotMs)
    if (await fixSwitchInConfig()) throw new Error('the switch is still on in config.json')
    await expectCompatibilityFix(paths.gameDir, 'absent')
    await expectReleaseMatchesRecord(paths.gameDir)
    await expectInstalled(await currentManifest())
    return shot
  })

  await step('the switch off in Settings (screenshot only)', async () => {
    await seedSettings({ language: 'en', amdCompatibilityPrompted: true })
    const shot = await runLauncher('7-fix-off-settings-en', { YUFA_GPU: 'amd', YUFA_VIEW: 'settings' }, panelShotMs)
    await expectCompatibilityFix(paths.gameDir, 'absent')
    return shot
  })
} finally {
  await server.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed; screenshots in ${shotsDir}`)
if (failed.length) {
  const log = join(userData, 'logs', 'main.log')
  if (existsSync(log)) {
    const lines = (await fs.readFile(log, 'utf8')).split('\n').filter((l) => /patcher:|error/i.test(l))
    console.log(`\nlauncher log (${log}):\n${lines.slice(-40).join('\n')}`)
  }
  process.exit(1)
}
