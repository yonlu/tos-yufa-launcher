import { describe, expect, it } from 'vitest'
import type { GpuDetection, PatcherStateName } from '@yufa/shared'
import { amdAdapterName, compatibilityPromptDecision, dxvkReason, dxvkRefusalKey } from '../src/renderer/src/lib/compatibilityFix'

const hybrid: GpuDetection = {
  amdDetected: true,
  adapters: [
    { vendorId: '0x8086', deviceId: '0x9a49', active: true, amd: false, name: 'Intel(R) Iris(R) Xe Graphics' },
    { vendorId: '0x1002', deviceId: '0x73df', active: false, amd: true, name: 'AMD Radeon RX 6700 XT' },
  ],
}
const nvidia: GpuDetection = {
  amdDetected: false,
  adapters: [{ vendorId: '0x10de', deviceId: '0x2484', active: true, amd: false, name: 'NVIDIA GeForce RTX 3070' }],
}
const fresh = { amdCompatibilityEnabled: false, amdCompatibilityPrompted: false }

describe('compatibilityPromptDecision', () => {
  it('shows once the launcher is ready with an AMD adapter listed and the prompt never answered', () => {
    expect(compatibilityPromptDecision({ state: 'ready', gpu: hybrid, settings: fresh })).toBe('show')
    expect(compatibilityPromptDecision({ state: 'up-to-date', gpu: hybrid, settings: fresh })).toBe('show')
  })

  it('waits while the launcher is not on a completed install', () => {
    const waiting: PatcherStateName[] = ['idle', 'checking', 'not-installed', 'installing', 'installing-runtimes', 'update-available', 'updating', 'verifying', 'repairing', 'error']
    for (const state of waiting) expect(compatibilityPromptDecision({ state, gpu: hybrid, settings: fresh })).toBe('wait')
  })

  it('waits without an AMD adapter, before app info and settings arrive, and once the prompt was answered', () => {
    expect(compatibilityPromptDecision({ state: 'ready', gpu: nvidia, settings: fresh })).toBe('wait')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: null, settings: fresh })).toBe('wait')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: hybrid, settings: null })).toBe('wait')
    expect(compatibilityPromptDecision({ state: 'ready', gpu: hybrid, settings: { ...fresh, amdCompatibilityPrompted: true } })).toBe('wait')
  })

  it('settles without asking when the fix was already switched on from Settings', () => {
    expect(compatibilityPromptDecision({ state: 'ready', gpu: hybrid, settings: { ...fresh, amdCompatibilityEnabled: true } })).toBe('settle')
  })
})

describe('amdAdapterName', () => {
  it('names the AMD adapter, active or not', () => {
    expect(amdAdapterName(hybrid)).toBe('AMD Radeon RX 6700 XT')
  })

  it('is null without an AMD adapter, before app info, or when the adapter has no name', () => {
    expect(amdAdapterName(nvidia)).toBeNull()
    expect(amdAdapterName(null)).toBeNull()
    expect(amdAdapterName({ amdDetected: true, adapters: [{ vendorId: '0x1002', deviceId: null, active: true, amd: true, name: null }] })).toBeNull()
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
