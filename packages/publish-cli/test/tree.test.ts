import { describe, expect, it } from 'vitest'
import { isHardGuarded } from '../src/tree'

describe('isHardGuarded', () => {
  it('drops the Compatibility fix path, whatever its case (ADR 0003)', () => {
    expect(isHardGuarded('release/d3d9.dll')).toBe(true)
    expect(isHardGuarded('Release/D3D9.DLL')).toBe(true)
  })

  it('guards only that exact path, not the client runtime DLLs next to it', () => {
    expect(isHardGuarded('release/d3dx9_43.dll')).toBe(false)
    expect(isHardGuarded('release/d3d9.dll.bak')).toBe(false)
    expect(isHardGuarded('d3d9.dll')).toBe(false)
  })

  it('keeps the Player-owned Files guarded', () => {
    expect(isHardGuarded('release/user.xml')).toBe(true)
    expect(isHardGuarded('release/CheatLogData')).toBe(true)
    expect(isHardGuarded('release/chat_config_42.xml')).toBe(true)
    expect(isHardGuarded('release/uilayout.xml')).toBe(false)
  })
})
