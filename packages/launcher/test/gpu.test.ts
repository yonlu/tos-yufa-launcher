import { describe, expect, it } from 'vitest'
import { detectAmdGpu, noGpu } from '../src/main/gpu'

/** What `app.getGPUInfo('basic')` hands back on Windows: numeric PCI ids, one entry per adapter. */
const nvidia = { active: true, vendorId: 0x10de, deviceId: 0x2484 }
const intel = { active: true, vendorId: 0x8086, deviceId: 0x9a49 }

describe('detectAmdGpu (Compatibility fix detection, ADR 0003)', () => {
  it('finds AMD by numeric vendor id', () => {
    const r = detectAmdGpu({ gpuDevice: [{ active: true, vendorId: 0x1002, deviceId: 0x73df }] })
    expect(r.amdDetected).toBe(true)
    expect(r.adapters).toEqual([{ vendorId: '0x1002', deviceId: '0x73df', active: true, amd: true, name: null }])
  })

  it('accepts the hex string form of the vendor id', () => {
    expect(detectAmdGpu({ gpuDevice: [{ active: true, vendorId: '0x1002', deviceId: '0x73DF' }] })).toMatchObject({
      amdDetected: true,
      adapters: [{ vendorId: '0x1002', deviceId: '0x73df', amd: true }],
    })
  })

  it('accepts the decimal string form of the vendor id', () => {
    expect(detectAmdGpu({ gpuDevice: [{ active: true, vendorId: '4098', deviceId: '29663' }] })).toMatchObject({
      amdDetected: true,
      adapters: [{ vendorId: '0x1002', deviceId: '0x73df', amd: true }],
    })
  })

  it('a bare "1002" is decimal, not AMD', () => {
    expect(detectAmdGpu({ gpuDevice: [{ active: true, vendorId: '1002', deviceId: 1 }] }).amdDetected).toBe(false)
  })

  it('counts an inactive AMD adapter on a hybrid laptop', () => {
    const r = detectAmdGpu({ gpuDevice: [intel, { active: false, vendorId: 0x1002, deviceId: 0x1636 }] })
    expect(r.amdDetected).toBe(true)
    expect(r.adapters.map((a) => a.amd)).toEqual([false, true])
    expect(r.adapters[1]?.active).toBe(false)
  })

  it('mixed vendors without AMD: not detected, every adapter listed', () => {
    const r = detectAmdGpu({ gpuDevice: [nvidia, intel] })
    expect(r.amdDetected).toBe(false)
    expect(r.adapters.map((a) => a.vendorId)).toEqual(['0x10de', '0x8086'])
  })

  it('empty adapter list', () => {
    expect(detectAmdGpu({ gpuDevice: [] })).toEqual(noGpu())
  })

  it('tolerates a shape it does not understand', () => {
    const none = noGpu()
    expect(detectAmdGpu(undefined)).toEqual(none)
    expect(detectAmdGpu(null)).toEqual(none)
    expect(detectAmdGpu({})).toEqual(none)
    expect(detectAmdGpu({ gpuDevice: 'nope' })).toEqual(none)
    expect(detectAmdGpu({ gpuDevice: [null, 7, 'x'] })).toEqual(none)
  })

  it('keeps an adapter whose ids cannot be read, without calling it AMD', () => {
    const r = detectAmdGpu({ gpuDevice: [{ active: true, vendorId: 'AMD', deviceId: {} }] })
    expect(r.amdDetected).toBe(false)
    expect(r.adapters).toEqual([{ vendorId: null, deviceId: null, active: true, amd: false, name: null }])
  })

  it('carries the device name when Electron reports one', () => {
    const r = detectAmdGpu({
      gpuDevice: [{ active: true, vendorId: 0x1002, deviceId: 0x73df, vendorString: 'AMD', deviceString: 'AMD Radeon RX 6700 XT' }],
    })
    expect(r.adapters[0]?.name).toBe('AMD Radeon RX 6700 XT')
  })

  it('treats a missing active flag as active', () => {
    expect(detectAmdGpu({ gpuDevice: [{ vendorId: 0x1002, deviceId: 0x73df }] }).adapters[0]?.active).toBe(true)
  })
})
