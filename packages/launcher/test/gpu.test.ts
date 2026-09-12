import { describe, expect, it } from 'vitest'
import { describeGpu, detectAmdGpu, noGpu } from '../src/main/gpu'

/**
 * What the two probes hand back on Windows, measured on an AM5 desktop whose
 * CPU carries AMD graphics next to an NVIDIA card. `basic` lists everything
 * and flags nothing active; `complete` flags the one adapter Chromium renders
 * on. Hardware acceleration off makes `complete` invent a single WARP adapter
 * and forget the real hardware.
 */
const nvidia = { vendorId: 0x10de, deviceId: 0x2204, deviceString: 'NVIDIA GeForce RTX 3090' }
const amdIntegrated = { vendorId: 0x1002, deviceId: 0x13c0, deviceString: 'AMD Radeon(TM) Graphics' }
const radeon = { vendorId: 0x1002, deviceId: 0x73df, deviceString: 'AMD Radeon RX 6700 XT' }
const intel = { vendorId: 0x8086, deviceId: 0x9a49, deviceString: 'Intel(R) Iris(R) Xe Graphics' }
const basicRenderDriver = { vendorId: 0x1414, deviceId: 0x008c, deviceString: 'Microsoft Basic Render Driver' }
const warp = { vendorId: 0xffff, deviceId: 0xffff, deviceString: 'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11)' }

const basic = (...devs: object[]): unknown => ({ gpuDevice: devs.map((d) => ({ ...d, active: false })) })
const complete = (active: object, ...rest: object[]): unknown => ({
  gpuDevice: [{ ...active, active: true }, ...rest.map((d) => ({ ...d, active: false }))],
})

describe('detectAmdGpu (Compatibility fix detection, ADR 0003)', () => {
  it('an AM5 desktop rendering on the card: AMD listed, not what renders', () => {
    const r = detectAmdGpu(basic(nvidia, amdIntegrated, basicRenderDriver), complete(nvidia, amdIntegrated, basicRenderDriver))
    expect(r.amdDetected).toBe(true)
    expect(r.amdActive).toBe(false)
    expect(r.adapters.map((a) => a.active)).toEqual([true, false, false])
  })

  it('an AMD-only machine: AMD is what renders', () => {
    const r = detectAmdGpu(basic(radeon, basicRenderDriver), complete(radeon, basicRenderDriver))
    expect(r.amdDetected).toBe(true)
    expect(r.amdActive).toBe(true)
  })

  it('an AMD card next to an integrated Intel chip: the card renders', () => {
    const r = detectAmdGpu(basic(intel, radeon), complete(radeon, intel))
    expect(r.amdActive).toBe(true)
    expect(r.adapters.map((a) => a.active)).toEqual([false, true])
  })

  it('hardware acceleration off: the inventory survives, what renders is unknown', () => {
    const r = detectAmdGpu(basic(nvidia, amdIntegrated, basicRenderDriver), complete(warp))
    expect(r.amdDetected).toBe(true)
    expect(r.amdActive).toBeNull()
    expect(r.adapters.map((a) => a.name)).toEqual([nvidia.deviceString, amdIntegrated.deviceString, basicRenderDriver.deviceString])
    expect(r.adapters.every((a) => !a.active)).toBe(true)
  })

  it("Microsoft's own renderer in front hides the hardware rather than answering for it", () => {
    expect(detectAmdGpu(basic(radeon, basicRenderDriver), complete(basicRenderDriver, radeon)).amdActive).toBeNull()
  })

  it('marks the software adapters, which the game never renders on', () => {
    const r = detectAmdGpu(basic(radeon, basicRenderDriver, warp))
    expect(r.adapters.map((a) => a.software)).toEqual([false, true, true])
  })

  it('without the complete probe: the inventory stands, what renders is unknown', () => {
    const r = detectAmdGpu(basic(amdIntegrated, nvidia))
    expect(r.amdDetected).toBe(true)
    expect(r.amdActive).toBeNull()
    expect(r.adapters.every((a) => !a.active)).toBe(true)
  })

  it("ignores the basic probe's own active flags, which Windows reports false on every adapter", () => {
    const r = detectAmdGpu({ gpuDevice: [{ ...radeon, active: true }] })
    expect(r.adapters[0]?.active).toBe(false)
    expect(r.amdActive).toBeNull()
  })

  it('normalises the PCI ids Electron may report as numbers or strings', () => {
    expect(detectAmdGpu({ gpuDevice: [{ vendorId: 0x1002, deviceId: 0x73df }] }).adapters[0]).toMatchObject({
      vendorId: '0x1002',
      deviceId: '0x73df',
      amd: true,
    })
    expect(detectAmdGpu({ gpuDevice: [{ vendorId: '0x1002', deviceId: '0x73DF' }] }).adapters[0]).toMatchObject({ vendorId: '0x1002', amd: true })
    expect(detectAmdGpu({ gpuDevice: [{ vendorId: '4098', deviceId: '29663' }] }).adapters[0]).toMatchObject({ deviceId: '0x73df', amd: true })
  })

  it('a bare "1002" is decimal, not AMD', () => {
    expect(detectAmdGpu({ gpuDevice: [{ vendorId: '1002', deviceId: 1 }] }).amdDetected).toBe(false)
  })

  it('matches the active adapter on both ids, so two cards of one vendor do not stand in for each other', () => {
    const r = detectAmdGpu(basic(amdIntegrated, radeon), complete(radeon, amdIntegrated))
    expect(r.adapters.map((a) => a.active)).toEqual([false, true])
    expect(r.amdActive).toBe(true)
  })

  it('empty adapter list', () => {
    expect(detectAmdGpu({ gpuDevice: [] })).toEqual(noGpu())
  })

  it('tolerates a shape it does not understand, in either probe', () => {
    const none = noGpu()
    expect(detectAmdGpu(undefined)).toEqual(none)
    expect(detectAmdGpu(null)).toEqual(none)
    expect(detectAmdGpu({})).toEqual(none)
    expect(detectAmdGpu({ gpuDevice: 'nope' })).toEqual(none)
    expect(detectAmdGpu({ gpuDevice: [null, 7, 'x'] })).toEqual(none)
    expect(detectAmdGpu(basic(radeon), 'nope').amdActive).toBeNull()
    expect(detectAmdGpu(basic(radeon), { gpuDevice: [{ active: true, vendorId: {} }] }).amdActive).toBeNull()
  })

  it('keeps an adapter whose ids cannot be read, without calling it AMD or software', () => {
    const r = detectAmdGpu({ gpuDevice: [{ vendorId: 'AMD', deviceId: {} }] })
    expect(r.amdDetected).toBe(false)
    expect(r.adapters).toEqual([{ vendorId: null, deviceId: null, active: false, amd: false, software: false, name: null }])
  })

  it('carries the device name when Electron reports one', () => {
    expect(detectAmdGpu(basic(radeon)).adapters[0]?.name).toBe('AMD Radeon RX 6700 XT')
    expect(detectAmdGpu({ gpuDevice: [{ vendorId: 0x1002, deviceId: 0x73df, deviceString: '  ' }] }).adapters[0]?.name).toBeNull()
  })
})

describe('describeGpu', () => {
  it('says what renders, then the inventory', () => {
    expect(describeGpu(detectAmdGpu(basic(nvidia, amdIntegrated), complete(nvidia, amdIntegrated)))).toBe(
      'AMD idle; active 0x10de:0x2204 (NVIDIA GeForce RTX 3090); adapters: 0x10de:0x2204 (NVIDIA GeForce RTX 3090), 0x1002:0x13c0 (AMD Radeon(TM) Graphics)',
    )
  })

  it('separates AMD rendering, AMD listed but unknown, and no AMD at all', () => {
    expect(describeGpu(detectAmdGpu(basic(radeon), complete(radeon)))).toMatch(/^AMD renders;/)
    expect(describeGpu(detectAmdGpu(basic(radeon), complete(warp)))).toMatch(/^AMD listed, renderer unknown; no active adapter named;/)
    expect(describeGpu(detectAmdGpu(basic(nvidia), complete(warp)))).toMatch(/^no AMD;/)
  })

  it('has a line for a machine that listed nothing', () => {
    expect(describeGpu(noGpu())).toBe('no adapters listed')
  })
})
