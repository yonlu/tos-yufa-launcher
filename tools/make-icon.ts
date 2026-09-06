// Generates packages/launcher/build/icon.ico (+ icon.png) from the website brand mark.
// Usage: npm run make-icon [-- <source-image>]
// The outputs are committed; builds never need sharp at CI time.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const source = process.argv[2] ?? 'C:/workspace/tos-classic/website/public/tos-classic-logo.webp'
const outDir = join(import.meta.dirname, '../packages/launcher/build')

// The mark sits centered in a large transparent canvas — trim first or it renders tiny.
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
