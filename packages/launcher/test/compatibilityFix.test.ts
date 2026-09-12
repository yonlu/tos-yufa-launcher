import { describe, expect, it } from 'vitest'
import type { GpuDetection, PatcherStateName } from '@yufa/shared'
import { amdAdapterName, amdRenders, compatibilityPromptDecision, dxvkReason, dxvkRefusalKey } from '../src/renderer/src/lib/compatibilityFix'

const radeon = { vendorId: '0x1002', deviceId: '0x73df', amd: true, software: false, name: 'AMD Radeon RX 6700 XT' }
const integratedAmd = { vendorId: '0x1002', deviceId: '0x13c0', amd: true, software: false, name: 'AMD Radeon(TM) Graphics' }
const geforce = { vendorId: '0x10de', deviceId: '0x2204', amd: false, software: false, name: 'NVIDIA GeForce RTX 3090' }
const basicRenderDriver = { vendorId: '0x1414', deviceId: '0x008c', amd: false, software: true, name: 'Microsoft Basic Render Driver' }

/** An AMD card, rendering: the machine the fix is for. */
const amd: GpuDetection = { amdDetected: true, amdActive: true, adapters: [{ ...radeon, active: true }] }
/** An AM5 desktop: the CPU's AMD graphics are listed, the game runs on the card. */
const amdIdle: GpuDetection = {
  amdDetected: true,
  amdActive: false,
  adapters: [
    { ...geforce, active: true },
    { ...integratedAmd, active: false },
  ],
}
/** Hardware acceleration off on that same desktop: the inventory stands, nothing says what renders. */
const amdIdleUnknown: GpuDetection = { ...amdIdle, amdActive: null, adapters: amdIdle.adapters.map((a) => ({ ...a, active: false })) }
/** Hardware acceleration off with nothing but AMD in the machine. */
const amdOnlyUnknown: GpuDetection = {
  amdDetected: true,
  amdActive: null,
  adapters: [
    { ...radeon, active: false },
    { ...basicRenderDriver, active: false },
  ],
}
const nvidia: GpuDetection = { amdDetected: false, amdActive: false, adapters: [{ ...geforce, active: true }] }
const fresh = { amdCompatibilityEnabled: false, amdCompatibilityPrompted: false }

describe('amdRenders (which machines the prompt is for, ADR 0003)', () => {
  it('an AMD adapter that renders', () => {
    expect(amdRenders(amd)).toBe(true)
  })

  it('an AMD adapter the game will not use, beside the card it will', () => {
    expect(amdRenders(amdIdle)).toBe(false)
  })

  it('nothing but AMD in the machine, even when Chromium could not say what renders', () => {
    expect(amdRenders(amdOnlyUnknown)).toBe(true)
  })

  it('AMD beside a card, and no answer about which renders: not asked, the switch is in Settings', () => {
    expect(amdRenders(amdIdleUnknown)).toBe(false)
  })

  it('no AMD at all, and before app info arrives', () => {
    expect(amdRenders(nvidia)).toBe(false)
    expect(amdRenders(null)).toBe(false)
  })

  it('a machine that listed only software renderers answers for nothing', () => {
    expect(amdRenders({ amdDetected: true, amdActive: null, adapters: [{ ...basicRenderDriver, active: true }] })).toBe(false)
  })
})

describe('compatibilityPromptDecision', () => {
  it('shows once the launcher is ready on a machine that renders on AMD and the prompt was never answered', () => {
    expect(compatibilityPromptDecision({ state: 'ready', gpu: amd, settings: fresh })).toBe('show')
    expect(compatibilityPromptDecision({ state: 'up-to-date', gpu: amd, settings: fresh })).toBe('show')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: amdOnlyUnknown, settings: fresh })).toBe('show')
  })

  it('waits while the launcher is not on a completed install', () => {
    const waiting: PatcherStateName[] = ['idle', 'checking', 'not-installed', 'installing', 'installing-runtimes', 'update-available', 'updating', 'verifying', 'repairing', 'error']
    for (const state of waiting) expect(compatibilityPromptDecision({ state, gpu: amd, settings: fresh })).toBe('wait')
  })

  it('waits when AMD is listed but idle: the AM5 desktop is not asked anything', () => {
    expect(compatibilityPromptDecision({ state: 'ready', gpu: amdIdle, settings: fresh })).toBe('wait')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: amdIdleUnknown, settings: fresh })).toBe('wait')
  })

  it('waits without an AMD adapter, before app info and settings arrive, and once the prompt was answered', () => {
    expect(compatibilityPromptDecision({ state: 'ready', gpu: nvidia, settings: fresh })).toBe('wait')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: null, settings: fresh })).toBe('wait')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: amd, settings: null })).toBe('wait')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: amd, settings: { ...fresh, amdCompatibilityPrompted: true } })).toBe('wait')
  })

  it('settles without asking when the fix was already switched on from Settings', () => {
    expect(compatibilityPromptDecision({ state: 'ready', gpu: amd, settings: { ...fresh, amdCompatibilityEnabled: true } })).toBe('settle')
  })
})

describe('amdAdapterName', () => {
  it('names the AMD adapter whether or not it is the one rendering, because the Settings row describes the machine', () => {
    expect(amdAdapterName(amd)).toBe('AMD Radeon RX 6700 XT')
    expect(amdAdapterName(amdIdle)).toBe('AMD Radeon(TM) Graphics')
  })

  it('is null without an AMD adapter, before app info, or when the adapter has no name', () => {
    expect(amdAdapterName(nvidia)).toBeNull()
    expect(amdAdapterName(null)).toBeNull()
    expect(
      amdAdapterName({
        amdDetected: true,
        amdActive: true,
        adapters: [{ vendorId: '0x1002', deviceId: null, active: true, amd: true, software: false, name: null }],
      }),
    ).toBeNull()
  })
})

describe('dxvkReason', () => {
  it('is null for an outcome that needs no explanation', () => {
    expect(dxvkReason({ outcome: 'installed', enabled: true })).toBeNull()
    expect(dxvkReason({ outcome: 'removed', enabled: false })).toBeNull()
    expect(dxvkReason(undefined)).toBeNull()
  })

  it('names the reasons the locales spell out and folds the rest into failed', () => {
    expect(dxvkReason({ outcome: 'foreign', enabled: false, error: { code: 'foreign-dll', message: 'C:\\x\\release\\d3d9.dll' } })).toBe('foreign-dll')
    expect(dxvkReason({ outcome: 'failed', enabled: false, error: { code: 'game-running' } })).toBe('game-running')
    expect(dxvkReason({ outcome: 'failed', enabled: false, error: { code: 'busy' } })).toBe('busy')
    expect(dxvkReason({ outcome: 'failed', enabled: true, error: { code: 'file-locked', message: 'x' } })).toBe('file-locked')
    expect(dxvkReason({ outcome: 'failed', enabled: false, error: { code: 'dxvk-failed', message: 'ENOSPC' } })).toBe('failed')
  })
})

describe('dxvkRefusalKey', () => {
  it('has its own wording where a refusal reads differently from the warning at ready', () => {
    expect(dxvkRefusalKey('foreign-dll')).toBe('dxvk.refusal.foreign-dll')
    expect(dxvkRefusalKey('game-running')).toBe('dxvk.refusal.game-running')
  })

  it('shares the warning text for the rest', () => {
    expect(dxvkRefusalKey('busy')).toBe('dxvk.reason.busy')
    expect(dxvkRefusalKey('file-locked')).toBe('dxvk.reason.file-locked')
    expect(dxvkRefusalKey('failed')).toBe('dxvk.reason.failed')
  })
})
