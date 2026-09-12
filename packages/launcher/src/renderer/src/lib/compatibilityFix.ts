import type { DxvkResult, GpuDetection, PatcherStateName, Settings } from '@yufa/shared'

/**
 * What the one-time AMD prompt (ADR 0003) should do with what the renderer
 * knows right now. `show`: ask. `settle`: the fix is already on, so there is
 * nothing to offer; record the prompt as answered without showing it.
 * `wait`: not yet, or never.
 */
export type PromptDecision = 'show' | 'settle' | 'wait'

/** The launcher is on a completed install: the Install Record is complete on the way to either state. */
const PROMPT_STATES: ReadonlySet<PatcherStateName> = new Set(['ready', 'up-to-date'])

export function compatibilityPromptDecision(input: {
  state: PatcherStateName
  gpu: GpuDetection | null
  settings: Pick<Settings, 'amdCompatibilityEnabled' | 'amdCompatibilityPrompted'> | null
}): PromptDecision {
  const { state, gpu, settings } = input
  if (!PROMPT_STATES.has(state) || !amdRenders(gpu) || !settings || settings.amdCompatibilityPrompted) return 'wait'
  return settings.amdCompatibilityEnabled ? 'settle' : 'show'
}

/**
 * Will the game render on AMD? What the unasked prompt turns on (ADR 0003):
 * an AMD adapter merely being present is not enough, because a desktop whose
 * CPU carries integrated AMD graphics lists one next to the card the game
 * actually uses, and asking those players to translate D3D9 to Vulkan is
 * wrong.
 *
 * `amdActive` answers it outright wherever Chromium named the adapter it
 * renders on. It is null when nothing real was named — hardware acceleration
 * off leaves Chromium on Microsoft's software renderer, which reports no
 * hardware at all — and then the fallback is the only thing left to say: on a
 * machine whose every real adapter is AMD, there is nothing else the game
 * could pick.
 *
 * The case this gives up is the hybrid laptop that renders the launcher on a
 * non-AMD chip and the game on an AMD one. Those players reach the fix
 * through the switch in Settings, which is always offered; the prompt says so
 * before it is dismissed.
 */
export function amdRenders(gpu: GpuDetection | null): boolean {
  if (!gpu?.amdDetected) return false
  if (gpu.amdActive !== null) return gpu.amdActive
  const real = gpu.adapters.filter((a) => !a.software)
  return real.length > 0 && real.every((a) => a.amd)
}

/** The AMD adapter's name for the prompt and the switch; null when none is listed or it came without one. */
export function amdAdapterName(gpu: GpuDetection | null): string | null {
  return gpu?.adapters.find((a) => a.amd)?.name ?? null
}

/** Reasons the locales spell out one by one; anything else falls back to the generic line. */
export type DxvkReason = 'foreign-dll' | 'game-running' | 'file-locked' | 'busy' | 'failed'

const NAMED_REASONS: ReadonlySet<string> = new Set<DxvkReason>(['foreign-dll', 'game-running', 'file-locked', 'busy'])

/** Why a Compatibility fix operation did not do what was asked, as a locale key suffix; null when it did. */
export function dxvkReason(result: DxvkResult | undefined): DxvkReason | null {
  const code = result?.error?.code
  if (!code) return null
  return NAMED_REASONS.has(code) ? (code as DxvkReason) : 'failed'
}

/** Reasons worded differently when the player asked (a refusal) than when the launcher re-applied at ready (a warning). */
const REFUSAL_WORDING: ReadonlySet<DxvkReason> = new Set<DxvkReason>(['foreign-dll', 'game-running'])

/** The locale key explaining a refused enable or disable: its own wording where it differs, the warning's otherwise. */
export function dxvkRefusalKey(reason: DxvkReason): string {
  return REFUSAL_WORDING.has(reason) ? `dxvk.refusal.${reason}` : `dxvk.reason.${reason}`
}
