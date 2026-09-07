import { describe, expect, it } from 'vitest'
import { clampToWorkArea, WINDOW_TARGET } from '../src/main/windowSize'

describe('clampToWorkArea (the launcher window fits the primary display)', () => {
  it('a desktop with room keeps the 1200 by 700 target', () => {
    expect(clampToWorkArea(WINDOW_TARGET, { width: 1920, height: 1040 })).toEqual({ width: 1200, height: 700 })
  })

  it('a 1366 by 768 laptop with a taskbar loses height, not width', () => {
    // Windows 10 taskbar is 40 px: the work area is 1366 by 728
    expect(clampToWorkArea(WINDOW_TARGET, { width: 1366, height: 728 })).toEqual({ width: 1200, height: 700 })
    // a 48 px taskbar plus a docked toolbar leaves 680
    expect(clampToWorkArea(WINDOW_TARGET, { width: 1366, height: 680 })).toEqual({ width: 1200, height: 680 })
  })

  it('a narrow work area loses width', () => {
    expect(clampToWorkArea(WINDOW_TARGET, { width: 1024, height: 768 })).toEqual({ width: 1024, height: 700 })
  })

  it('a work area smaller in both directions clamps both', () => {
    expect(clampToWorkArea(WINDOW_TARGET, { width: 1024, height: 600 })).toEqual({ width: 1024, height: 600 })
  })
})
