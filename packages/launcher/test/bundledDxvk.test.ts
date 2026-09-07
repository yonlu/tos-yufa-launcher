import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DXVK_FILE, DXVK_LICENSE_FILE } from '@yufa/shared'
import { resolveBundledDxvk } from '../src/main/bundledDxvk'

describe('resolveBundledDxvk (where the Compatibility fix lives in each kind of run)', () => {
  it('packaged: under resources/dxvk next to the asar', () => {
    const r = resolveBundledDxvk({ isPackaged: true, resourcesPath: 'C:\\Hyped Games\\Yufa Launcher\\resources', mainDir: 'ignored' })
    expect(r.dir).toBe(join('C:\\Hyped Games\\Yufa Launcher\\resources', 'dxvk'))
    expect(r.dll).toBe(join(r.dir, DXVK_FILE))
    expect(r.license).toBe(join(r.dir, DXVK_LICENSE_FILE))
  })

  it('dev: the staged build/dxvk folder, resolved from out/main', () => {
    const mainDir = join('/repo', 'packages', 'launcher', 'out', 'main')
    const r = resolveBundledDxvk({ isPackaged: false, resourcesPath: '/electron/resources', mainDir })
    expect(r.dir).toBe(join('/repo', 'packages', 'launcher', 'build', 'dxvk'))
    expect(r.dll).toBe(join(r.dir, DXVK_FILE))
  })
})
