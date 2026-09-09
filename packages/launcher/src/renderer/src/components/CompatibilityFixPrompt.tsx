import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DxvkResult } from '@yufa/shared'
import { amdAdapterName, compatibilityPromptDecision, dxvkReason } from '../lib/compatibilityFix'
import { focusRing, monoLabel, surfaceButton } from '../lib/ui'
import { useLauncher } from '../store'
import { CompatibilityFixRefusal } from './CompatibilityFixRefusal'

/** What the prompt is doing, for Home to lay out around it (the subtitle gives it its place while it is open). */
export interface CompatibilityFixPromptState {
  open: boolean
  working: boolean
  result: DxvkResult | null
  answer(enable: boolean): Promise<void>
  close(): void
}

/**
 * The one-time offer of the Compatibility fix (ADR 0003): after the first
 * ready or up-to-date on a completed install, when an AMD adapter is listed
 * and the player has not answered yet. Enable or Not now; the prompted flag
 * is set either way, so the offer never comes back. An enable that is
 * refused (a foreign d3d9.dll, the game running) says why in place; the
 * switch in Settings is the way to try again.
 */
export function useCompatibilityFixPrompt(): CompatibilityFixPromptState {
  const state = useLauncher((s) => s.patcher.state)
  const gpu = useLauncher((s) => s.gpu)
  const settings = useLauncher((s) => s.settings)
  const saveSettings = useLauncher((s) => s.saveSettings)
  const setCompatibilityFix = useLauncher((s) => s.setCompatibilityFix)
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<DxvkResult | null>(null)

  const decision = compatibilityPromptDecision({ state, gpu, settings })
  useEffect(() => {
    if (decision === 'show') setOpen(true)
    // switched on from Settings before the prompt got its turn: nothing to offer, never ask
    if (decision === 'settle') void saveSettings({ amdCompatibilityPrompted: true })
  }, [decision, saveSettings])

  /** The flag first, so the answer is on record before the file moves, then the fix itself. */
  async function answer(enable: boolean): Promise<void> {
    setWorking(true)
    try {
      await saveSettings({ amdCompatibilityPrompted: true })
      const outcome = enable ? await setCompatibilityFix(true) : null
      if (outcome && dxvkReason(outcome)) setResult(outcome)
      else setOpen(false)
    } finally {
      setWorking(false)
    }
  }

  return { open, working, result, answer, close: () => setOpen(false) }
}

/**
 * The offer itself, in the subtitle's place on Home: the question, the
 * adapter it found, Enable and Not now. Nothing floats over the page and
 * Play stays in reach; an unanswered offer simply comes back next time.
 */
export function CompatibilityFixPrompt({ prompt }: { prompt: CompatibilityFixPromptState }) {
  const gpu = useLauncher((s) => s.gpu)
  const { t } = useTranslation()
  if (!prompt.open) return null

  const adapter = amdAdapterName(gpu)
  const refused = dxvkReason(prompt.result ?? undefined) !== null

  return (
    <div role="region" aria-labelledby="compat-fix-title" className="border-l-2 border-tos-brown-muted pl-3">
      <p id="compat-fix-title" className="text-sm font-medium text-tos-brown">
        {t('dxvk.prompt.title')}
      </p>
      <p className="mt-0.5 text-[13px] leading-[1.45] text-tos-brown-light">{t('dxvk.prompt.body')}</p>
      {adapter && <p className={`mt-1.5 ${monoLabel}`}>{t('dxvk.adapter', { name: adapter })}</p>}

      {refused ? (
        <div className="mt-2">
          <p className="text-[13px] text-tos-brown">{t('dxvk.prompt.refused')}</p>
          <CompatibilityFixRefusal result={prompt.result} />
          <button type="button" onClick={prompt.close} className={`mt-3 ${surfaceButton}`}>
            {t('dxvk.prompt.close')}
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={prompt.working}
              onClick={() => void prompt.answer(true)}
              className={`h-10 shrink-0 rounded-md border border-tos-burgundy px-4 text-sm font-medium text-tos-burgundy transition-colors hover:bg-tos-burgundy hover:text-tos-cream disabled:cursor-default disabled:opacity-60 ${focusRing}`}
            >
              {t('dxvk.prompt.enable')}
            </button>
            <button
              type="button"
              disabled={prompt.working}
              onClick={() => void prompt.answer(false)}
              className={`shrink-0 whitespace-nowrap ${surfaceButton}`}
            >
              {t('dxvk.prompt.notNow')}
            </button>
          </div>
          <p className="mt-2 text-xs text-tos-brown-muted">{t('dxvk.prompt.later')}</p>
        </div>
      )}
    </div>
  )
}
