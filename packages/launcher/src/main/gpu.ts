import type { GpuAdapter, GpuDetection } from '@yufa/shared'

/** PCI vendor id of AMD/ATI. */
export const AMD_VENDOR_ID = 0x1002

/** The answer when nothing usable came back: no AMD, nothing listed. A fresh object each time, so nobody shares a list. */
export function noGpu(): GpuDetection {
  return { amdDetected: false, adapters: [] }
}

/**
 * Reads `app.getGPUInfo('basic')` for the Compatibility fix (ADR 0003): is
 * there an AMD adapter in the machine? Any listed adapter counts, active or
 * not, because a hybrid laptop may run the game on the chip Chromium is not
 * using, and the prompt has a Not now. Pure and tolerant of any shape:
 * anything unreadable yields no AMD rather than a crash at startup.
 *
 * Electron reports PCI ids as numbers on Windows and has reported strings
 * elsewhere; `0x1002`, `4098` and 4098 are all the same vendor. A bare
 * `1002` is read as decimal, as Electron would write it.
 */
export function detectAmdGpu(gpuInfo: unknown): GpuDetection {
  if (!isRecord(gpuInfo) || !Array.isArray(gpuInfo['gpuDevice'])) return noGpu()
  const adapters: GpuAdapter[] = []
  for (const dev of gpuInfo['gpuDevice']) {
    if (!isRecord(dev)) continue
    const vendor = parseId(dev['vendorId'])
    const device = parseId(dev['deviceId'])
    adapters.push({
      vendorId: vendor === null ? null : formatId(vendor),
      deviceId: device === null ? null : formatId(device),
      active: dev['active'] !== false,
      amd: vendor === AMD_VENDOR_ID,
      name: typeof dev['deviceString'] === 'string' && dev['deviceString'].trim() ? dev['deviceString'].trim() : null,
    })
  }
  return { amdDetected: adapters.some((a) => a.amd), adapters }
}

/** One line for the log: `AMD detected; adapters: 0x8086:0x9a49 active, 0x1002:0x73df (AMD Radeon RX 6700 XT)`. */
export function describeGpu(d: GpuDetection): string {
  if (d.adapters.length === 0) return 'no adapters listed'
  const list = d.adapters
    .map((a) => `${a.vendorId ?? '?'}:${a.deviceId ?? '?'}${a.active ? ' active' : ''}${a.name ? ` (${a.name})` : ''}`)
    .join(', ')
  return `${d.amdDetected ? 'AMD detected' : 'no AMD'}; adapters: ${list}`
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
