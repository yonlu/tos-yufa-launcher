// One-command mock playground: fake patch flow, real game on Play.
//
//   npm run mock [-- --count 3 --size 10000000 --throttle 800000 --keep --exe <path>]
//
// Patching runs against a disposable sandbox game dir (fresh every run, so the update
// is always pending and the real install is never written to), served throttled so the
// progress bar is watchable. Clicking Play launches the REAL client via the
// YUFA_LAUNCH_EXE hook (default: the real install's Yuka.exe; falls back to a dxdiag
// copy inside the sandbox when the real exe isn't on this machine).
// Ctrl+C (or closing the launcher) tears everything down.
import { spawn, spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createDevServer } from './dev-server'

const REAL_EXE = 'C:\\tree of savior servers\\Classic\\release\\Yuka.exe'

const args = process.argv.slice(2)
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}
const has = (name: string): boolean => args.includes(`--${name}`)

const base = resolve(opt('base', './e2e-sandbox'))
const port = Number(opt('port', '8787'))
const throttle = Number(opt('throttle', '800000')) // ~800 KB/s
const count = opt('count', '3')
const size = opt('size', '10000000') // 3 × 10 MB ≈ 37 s of visible download

// 1. fresh fixture (unless --keep): reset revision so an update is always pending
if (!has('keep')) {
  await fs.rm(base, { recursive: true, force: true })
  const setup = spawnSync(
    'npx',
    ['tsx', join(import.meta.dirname, 'e2e-setup.ts'), '--base', base, '--url', `http://127.0.0.1:${port}/`, '--count', count, '--size', size],
    { stdio: 'inherit', shell: true },
  )
  if (setup.status !== 0) process.exit(setup.status ?? 1)
}

// 2. resolve what Play launches: the real client, or a stand-in when it's absent.
// (dxdiag: classic self-contained Win32 GUI that survives copy/rename — notepad/calc are
// Store-app trampolines on Win11 and console apps die under the detached spawn.)
let launchExe = opt('exe', REAL_EXE)
try {
  await fs.access(launchExe)
} catch {
  console.warn(`real client not found at ${launchExe} — Play will open dxdiag as a stand-in`)
  launchExe = join(base, 'game', 'release', 'Yuka.exe')
  await fs.copyFile('C:\\Windows\\System32\\dxdiag.exe', launchExe)
}

// 3. seed sandbox settings (fresh runs only): keep the launcher open after Play so the
// flow stays visible, and don't pass the game's -SERVICE /S args to the dxdiag stand-in
// (it rejects unknown switches with a usage dialog).
const configFile = join(base, 'userdata', 'config.json')
try {
  await fs.access(configFile)
} catch {
  const usingStandIn = launchExe !== opt('exe', REAL_EXE)
  await fs.mkdir(dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, JSON.stringify({ afterLaunch: 'stay', ...(usingStandIn ? { launchArgs: '' } : {}) }, null, 2))
}

// 4. patch server (in-process, throttled)
let server
try {
  server = await createDevServer({ root: join(base, 'store'), port, throttleBytesPerSec: throttle })
} catch (err) {
  console.error(`could not start patch server on port ${port} (already running?): ${(err as Error).message}`)
  process.exit(1)
}
console.log(`patch server: ${server.url}  (throttle ${Math.round(throttle / 1000)} KB/s)`)
setInterval(() => {
  while (server.requests.length) {
    const r = server.requests.shift()!
    console.log(`  ${r.status} ${r.path}${r.range ? `  Range: ${r.range}` : ''}`)
  }
}, 500).unref()

// 5. launcher: patches into the sandbox, Play spawns the real client
console.log(`starting launcher — click Atualizar, watch the bar, then Jogar (launches ${launchExe})`)
const dev = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    YUFA_MANIFEST_URL: `http://127.0.0.1:${port}/manifest.json`,
    YUFA_GAME_DIR: join(base, 'game'),
    YUFA_USERDATA: join(base, 'userdata'),
    YUFA_LAUNCH_EXE: launchExe,
  },
})

dev.on('exit', (code) => {
  void server.close().then(() => process.exit(code ?? 0))
})
