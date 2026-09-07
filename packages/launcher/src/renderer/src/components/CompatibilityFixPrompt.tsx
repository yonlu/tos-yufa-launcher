import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DxvkResult } from '@yufa/shared'
import { amdAdapterName, compatibilityPromptDecision, dxvkReason } from '../lib/compatibilityFix'
import { useLauncher } from '../store'
import { CompatibilityFixRefusal } from './CompatibilityFixRefusal'

/**
 * The one-time offer of the Compatibility fix (ADR 0003): after the first
 * ready or up-to-date on a completed install, when an AMD adapter is listed
 * and the player has not answered yet. Enable or Not now; the prompted flag
 * is set either way, so the modal never comes back. Enable that is refused
 * (a foreign d3d9.dll, the game running) says why in place; the switch in
 * Settings is the way to try again.
 */
export function CompatibilityFixPrompt() {
  const state = useLauncher((s) => s.patcher.state)
  const gpu = useLauncher((s) => s.gpu)
  const settings = useLauncher((s) => s.settings)
  const saveSettings = useLauncher((s) => s.saveSettings)
  const setCompatibilityFix = useLauncher((s) => s.setCompatibilityFix)
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<DxvkResult | null>(null)

  const decision = compatibilityPromptDecision({ state, gpu, settings })
  useEffect(() => {
    if (decision === 'show') setOpen(true)
    // switched on from Settings before the prompt got its turn: nothing to offer, never ask
    if (decision === 'settle') void saveSettings({ amdCompatibilityPrompted: true })
  }, [decision, saveSettings])

  if (!open) return null

  const adapter = amdAdapterName(gpu)
  const refused = dxvkReason(result ?? undefined) !== null

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

  const surfaceButton =
    'rounded-md bg-tos-tan px-4 py-2 text-sm text-tos-brown-light hover:bg-tos-border hover:text-tos-brown disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        role="dialog"
        aria-labelledby="compat-fix-title"
        className="animate-fade-up w-[480px] rounded-tos-panel border border-tos-border bg-tos-cream p-6 opacity-0 shadow-xl [animation-duration:0.3s]"
      >
        <h2 id="compat-fix-title" className="font-display mb-2 text-lg font-bold text-tos-burgundy">
          {t('dxvk.prompt.title')}
        </h2>
        <p className="text-sm text-tos-brown">{t('dxvk.prompt.body')}</p>
        {adapter && <p className="mt-2 text-xs text-tos-brown-light">{t('dxvk.adapter', { name: adapter })}</p>}
        <p className="mt-2 text-xs text-tos-brown-muted">{t('dxvk.prompt.later')}</p>

        {refused && (
          <div className="mt-4 rounded-tos-panel border border-tos-orange-dark/40 bg-tos-tan/60 px-3 py-2">
            <p className="mb-0.5 text-sm text-tos-brown">{t('dxvk.prompt.refused')}</p>
            <CompatibilityFixRefusal result={result} />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          {refused ? (
            <button type="button" onClick={() => setOpen(false)} className={surfaceButton}>
              {t('dxvk.prompt.close')}
            </button>
          ) : (
            <>
              <button type="button" disabled={working} onClick={() => void answer(false)} className={surfaceButton}>
                {t('dxvk.prompt.notNow')}
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => void answer(true)}
                className="font-display rounded-tos-cta bg-tos-orange px-5 py-2 text-sm font-bold uppercase tracking-wider text-white shadow-tos-cta transition-all hover:bg-tos-orange-dark hover:shadow-tos-cta-hover disabled:opacity-60"
              >
                {t('dxvk.prompt.enable')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
