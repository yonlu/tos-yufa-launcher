import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { release } from '../packages/publish-cli/src/commands'
import { DEFAULT_EXCLUDES, DEFAULT_SEED_ONCE, type PublishConfig } from '../packages/publish-cli/src/config'
import { LocalDirStore } from '../packages/publish-cli/src/store'
import { patchFileName } from '../packages/shared/src/index'

/**
 * Builds a local end-to-end sandbox: a fake full game tree published as a
 * Build into a local store (serve it with tools/dev-server.ts), and a game
 * dir holding only a stub client — a "located existing install" the launcher
 * heals by downloading the whole Build. Point YUFA_GAME_DIR at an empty
 * folder instead to exercise the not-installed → install path.
 *
 *   npx tsx tools/e2e-setup.ts --base <dir> [--url http://127.0.0.1:8787/] [--count 2] [--size 3000000]
 */

const args = process.argv.slice(2)
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}

const base = resolve(opt('base', './e2e-sandbox'))
const url = opt('url', 'http://127.0.0.1:8787/')
const count = Number(opt('count', '2'))
const size = Number(opt('size', '3000000'))
const BASE_REVISION = 1116000

const gameDir = join(base, 'game')
const storeDir = join(base, 'store')
const treeDir = join(base, 'tree')

async function put(rel: string, content: Buffer | string): Promise<void> {
  const abs = join(treeDir, ...rel.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content)
}

await mkdir(join(gameDir, 'release'), { recursive: true })
await mkdir(storeDir, { recursive: true })

// the fake full game tree: a few data archives, `count` patch archives of `size` bytes, a client, a Seed-once layout
await put('data/bg.ipf', randomBytes(256 * 1024))
await put('data/ui.ipf', randomBytes(64 * 1024))
await put('release/Yuka.exe', 'stub client - not a real executable')
await put('release/a.dll', randomBytes(16 * 1024))
await put('release/uilayout.xml', '<layout/>')
for (let i = 1; i <= count; i++) await put(`patch/${patchFileName(BASE_REVISION + i)}`, randomBytes(size))
// Player-owned junk the hard guard must drop
await put('release/user.xml', '<user login="operator"/>')
await put('release/release.revision.txt', String(BASE_REVISION + count))

await writeFile(join(gameDir, 'release', 'Yuka.exe'), 'stub client - not a real executable')

const cfg: PublishConfig = {
  bucket: 'e2e',
  endpoint: 'https://example.invalid',
  publicBaseUrl: url,
  manifestKey: 'manifest.json',
  manifestsPrefix: 'manifests/',
  objectsPrefix: 'objects/',
  redistPrefix: 'redist/',
  newsKey: 'news/news.json',
  newsImagesPrefix: 'news/img/',
  launcherPrefix: 'launcher/',
  excludes: [...DEFAULT_EXCLUDES],
  seedOnce: [...DEFAULT_SEED_ONCE],
  hashCache: join(base, 'hash-cache.json'),
}
const store = new LocalDirStore(storeDir)
await release({ cfg, store }, { dir: treeDir, label: 'e2e' })

await store.putText(
  'news/news.json',
  JSON.stringify({
    schemaVersion: 1,
    items: [
      {
        id: 'e2e-1',
        date: '2026-07-01',
        pinned: true,
        title: { 'pt-BR': 'Ambiente de teste E2E', en: 'E2E test environment' },
        body: {
          'pt-BR': 'Este manifest é servido pelo dev-server local. Baixe os patches e clique em Jogar.',
          en: 'This manifest is served by the local dev-server. Download the patches and hit Play.',
        },
      },
      {
        id: 'e2e-2',
        date: '2026-06-28',
        title: { 'pt-BR': 'Segunda notícia', en: 'Second news item' },
        body: { 'pt-BR': 'Um card comum, sem destaque.', en: 'A regular, unpinned card.' },
      },
    ],
  }),
)

console.log(
  JSON.stringify(
    {
      gameDir,
      storeDir,
      manifestUrl: `${url}manifest.json`,
      serve: `npx tsx tools/dev-server.ts --root "${storeDir}" --port 8787`,
    },
    null,
    2,
  ),
)
