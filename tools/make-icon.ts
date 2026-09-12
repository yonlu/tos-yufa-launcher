// Generates packages/launcher/build/icon.ico (+ icon.png) from the brand mark.
// Usage: npm run make-icon [-- <source-image>]
// The default source is the launcher's own logo asset, so the icon is
// reproducible from the repo alone; pass a higher-resolution master to
// override. The outputs are committed; builds never need sharp at CI time.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const repoRoot = join(import.meta.dirname, '..')
const source = process.argv[2] ?? join(repoRoot, 'packages/launcher/src/renderer/src/assets/logo.webp')
const outDir = join(repoRoot, 'packages/launcher/build')

// A mark centered in a large transparent canvas renders tiny — trim first.
// The committed asset is already tight, so this is a no-op for the default.
const trimmed = await sharp(source).trim().toBuffer()
const { width = 0, height = 0 } = await sharp(trimmed).metadata()
const side = Math.max(width, height)

const squared = await sharp(trimmed)
  .extend({
    top: Math.floor((side - height) / 2),
    bottom: Math.ceil((side - height) / 2),
    left: Math.floor((side - width) / 2),
    right: Math.ceil((side - width) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .toBuffer()

const sizes = [256, 128, 64, 48, 32, 16]
const pngs = await Promise.all(sizes.map((s) => sharp(squared).resize(s, s).png().toBuffer()))

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'icon.ico'), await pngToIco(pngs))
await writeFile(join(outDir, 'icon.png'), pngs[0]!)
console.log(`wrote ${outDir}/icon.ico (+ icon.png) from ${source} (trimmed ${width}x${height})`)
