// electron-builder beforePack hook (electron-builder.yml). The packaged
// launcher must carry the Compatibility fix (ADR 0003), so refuse to build
// when tools/fetch-dxvk.ts has not staged it. Kept dependency-free: the hook
// runs under electron-builder's own node, outside tsx.
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const stageDir = join(__dirname, 'dxvk')
const missing = ['d3d9.dll', 'LICENSE'].filter((f) => !existsSync(join(stageDir, f)))

module.exports = async function checkDxvk() {
  if (missing.length === 0) return
  throw new Error(
    `DXVK is not staged: ${missing.join(', ')} missing from ${stageDir}.\n` +
      'Run "npm run fetch-dxvk" from the repo root first (see README, Compatibility fix).',
  )
}
