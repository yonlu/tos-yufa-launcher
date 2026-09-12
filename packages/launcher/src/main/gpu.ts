import type { GpuAdapter, GpuDetection } from '@yufa/shared'

/** PCI vendor id of AMD/ATI. */
export const AMD_VENDOR_ID = 0x1002

/** PCI vendor id of Microsoft's own renderers: the Basic Render Driver, WARP. Not a card on the bus. */
export const MICROSOFT_VENDOR_ID = 0x1414

/** The id Chromium writes when it made the adapter up rather than reading it off the bus. */
export const SYNTHETIC_ID = 0xffff

/** The answer when nothing usable came back: no AMD, nothing listed, nothing known about what renders. */
export function noGpu(): GpuDetection {
  return { amdDetected: false, amdActive: null, adapters: [] }
}

/**
 * Reads Chromium's own GPU lists for the Compatibility fix (ADR 0003). Two
 * probes, because neither answers alone:
 *
 * - `basic` is the inventory. It lists every adapter Windows knows, fast, but
 *   reports `active: false` on all of them, so it cannot say which one renders.
 * - `complete` marks the adapter Chromium renders on. With hardware
 *   acceleration off it reports a single invented adapter (`0xffff:0xffff`,
 *   Microsoft's WARP) and loses the real hardware, so it is no inventory.
 *
 * So the adapters come from `basic` and the active flag from `complete`,
 * matched back by PCI id. `amdActive` is null whenever `complete` named
 * nothing real: unknown, which is not the same as no AMD. Pure and tolerant of
 * any shape; anything unreadable yields no AMD rather than a crash at startup.
 *
 * Electron reports PCI ids as numbers on Windows and has reported strings
 * elsewhere; `0x1002`, `4098` and 4098 are all the same vendor. A bare
 * `1002` is read as decimal, as Electron would write it.
 */
export function detectAmdGpu(basicInfo: unknown, completeInfo?: unknown): GpuDetection {
  const adapters = readAdapters(basicInfo)
  // Hardware acceleration off: basic says nothing usable, and complete is all there is.
  if (adapters.length === 0) return noGpu()

  // The basic probe's own active flags are always false; the complete probe's answer replaces them wholesale.
  const active = readActiveAdapter(completeInfo)
  for (const a of adapters) {
    a.active = active !== null && a.vendorId === active.vendorId && a.deviceId === active.deviceId
  }

  return {
    amdDetected: adapters.some((a) => a.amd),
    amdActive: active === null ? null : active.amd,
    adapters,
  }
}

/** Every adapter a `gpuDevice` list names, in the order Electron gave them. */
function readAdapters(gpuInfo: unknown): GpuAdapter[] {
  if (!isRecord(gpuInfo) || !Array.isArray(gpuInfo['gpuDevice'])) return []
  const adapters: GpuAdapter[] = []
  for (const dev of gpuInfo['gpuDevice']) {
    if (!isRecord(dev)) continue
    const vendor = parseId(dev['vendorId'])
    const device = parseId(dev['deviceId'])
    adapters.push({
      vendorId: vendor === null ? null : formatId(vendor),
      deviceId: device === null ? null : formatId(device),
      active: dev['active'] === true,
      amd: vendor === AMD_VENDOR_ID,
      software: vendor === MICROSOFT_VENDOR_ID || vendor === SYNTHETIC_ID,
      name: typeof dev['deviceString'] === 'string' && dev['deviceString'].trim() ? dev['deviceString'].trim() : null,
    })
  }
  return adapters
}

/**
 * Which adapter the complete probe says Chromium renders on, or null when it
 * does not say: no probe, no entry flagged active, an entry whose ids cannot
 * be read, or one of Microsoft's software renderers, which stands in front of
 * whatever the real hardware is and hides it.
 */
function readActiveAdapter(completeInfo: unknown): Pick<GpuAdapter, 'vendorId' | 'deviceId' | 'amd'> | null {
  const active = readAdapters(completeInfo).find((a) => a.active)
  if (!active || active.software || active.vendorId === null) return null
  return { vendorId: active.vendorId, deviceId: active.deviceId, amd: active.amd }
}

/** One line for the log: `AMD idle; active 0x10de:0x2204 (NVIDIA GeForce RTX 3090); adapters: ...`. */
export function describeGpu(d: GpuDetection): string {
  if (d.adapters.length === 0) return 'no adapters listed'
  const verdict = d.amdActive === null ? (d.amdDetected ? 'AMD listed, renderer unknown' : 'no AMD') : d.amdActive ? 'AMD renders' : 'AMD idle'
  const active = d.adapters.find((a) => a.active)
  const where = active ? `active ${active.vendorId ?? '?'}:${active.deviceId ?? '?'}${active.name ? ` (${active.name})` : ''}` : 'no active adapter named'
  const list = d.adapters.map((a) => `${a.vendorId ?? '?'}:${a.deviceId ?? '?'}${a.name ? ` (${a.name})` : ''}`).join(', ')
  return `${verdict}; ${where}; adapters: ${list}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16)
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  return null
}

function formatId(n: number): string {
  return `0x${n.toString(16).padStart(4, '0')}`
}
