import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { patch } from '../packages/publish-cli/src/commands'
import type { PublishConfig } from '../packages/publish-cli/src/config'
import { LocalDirStore } from '../packages/publish-cli/src/store'
import { GRANDFATHER_REVISION, patchFileName } from '../packages/shared/src/index'

/**
 * Builds a local end-to-end sandbox: a fixture game dir (fake client) and a
 * published patch store to serve with tools/dev-server.ts.
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

const gameDir = join(base, 'game')
const storeDir = join(base, 'store')
const staging = join(base, 'staging')

await mkdir(join(gameDir, 'patch'), { recursive: true })
await mkdir(join(gameDir, 'release'), { recursive: true })
await mkdir(storeDir, { recursive: true })
await mkdir(staging, { recursive: true })

await writeFile(join(gameDir, 'release', 'release.revision.txt'), String(GRANDFATHER_REVISION))
await writeFile(join(gameDir, 'release', 'Yuka.exe'), 'stub client - not a real executable')
await writeFile(join(gameDir, 'patch', patchFileName(11072)), randomBytes(4096))

const cfg: PublishConfig = {
  bucket: 'e2e',
  endpoint: 'https://example.invalid',
  publicBaseUrl: url,
  manifestKey: 'manifest.json',
  patchesPrefix: 'patches/',
  newsKey: 'news/news.json',
  newsImagesPrefix: 'news/img/',
  launcherPrefix: 'launcher/',
  grandfatherRevision: GRANDFATHER_REVISION,
}
const store = new LocalDirStore(storeDir)

const files: string[] = []
for (let i = 1; i <= count; i++) {
  const name = patchFileName(GRANDFATHER_REVISION + i)
  const path = join(staging, name)
  await writeFile(path, randomBytes(size))
  files.push(path)
}
await patch({ cfg, store }, { files })

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
