import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, saveSettings, selectGamePath, repair, checkRuntimes } = useLauncher()
  const { t } = useTranslation()
  const [invalidPath, setInvalidPath] = useState(false)

  if (!open || !settings) return null

  const label = 'mb-1 block text-xs font-medium uppercase tracking-wide text-tos-brown-light'
  const field =
    'w-full rounded-md border border-tos-input-border bg-tos-input-bg px-3 py-2 text-sm text-tos-brown outline-none focus:border-tos-orange'
  const surfaceButton =
    'rounded-md bg-tos-tan px-3 py-2 text-sm text-tos-brown-light hover:bg-tos-border hover:text-tos-brown'

  async function browse() {
    const result = await selectGamePath()
    if (result) setInvalidPath(!result.valid)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="animate-fade-up w-[540px] rounded-tos-panel border border-tos-border bg-tos-cream p-6 opacity-0 shadow-xl [animation-duration:0.3s]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display mb-5 text-lg font-bold text-tos-burgundy">{t('settings.title')}</h2>

        <div className="space-y-4">
          <div>
            <label className={label}>{t('settings.gamePath')}</label>
            <div className="flex gap-2">
              <input className={`${field} flex-1`} value={settings.gamePath} readOnly />
              <button type="button" onClick={() => void browse()} className={`shrink-0 ${surfaceButton}`}>
                {t('settings.browse')}
              </button>
            </div>
            {invalidPath && <p className="mt-1 text-xs text-tos-burgundy">{t('settings.invalidPath')}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>{t('settings.language')}</label>
              <select
                className={field}
                value={settings.language}
                onChange={(e) => void saveSettings({ language: e.target.value as 'pt-BR' | 'en' })}
              >
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className={label}>{t('settings.afterLaunch')}</label>
              <select
                className={field}
                value={settings.afterLaunch}
                onChange={(e) =>
                  void saveSettings({ afterLaunch: e.target.value as 'quit' | 'minimize' | 'stay' })
                }
              >
                <option value="quit">{t('settings.afterLaunch.quit')}</option>
                <option value="minimize">{t('settings.afterLaunch.minimize')}</option>
                <option value="stay">{t('settings.afterLaunch.stay')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={label}>{t('settings.launchArgs')}</label>
              <input
                className={field}
                defaultValue={settings.launchArgs}
                onBlur={(e) => void saveSettings({ launchArgs: e.target.value })}
                spellCheck={false}
              />
            </div>
            <div>
              <label className={label}>{t('settings.downloadConcurrency')}</label>
              <select
                className={field}
                value={settings.downloadConcurrency}
                onChange={(e) => void saveSettings({ downloadConcurrency: Number(e.target.value) as 1 | 2 | 3 })}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-tos-brown">
            <input
              type="checkbox"
              checked={settings.allowOfflinePlay}
              onChange={(e) => void saveSettings({ allowOfflinePlay: e.target.checked })}
              className="h-4 w-4 accent-tos-orange"
            />
            {t('settings.allowOffline')}
          </label>

          <div className="rounded-tos-panel border border-tos-border bg-tos-tan/60 p-3">
            <button
              type="button"
              onClick={() => {
                void repair()
                onClose()
              }}
              className={`font-display font-bold ${surfaceButton}`}
            >
              {t('settings.repair')}
            </button>
            <p className="mt-2 text-xs text-tos-brown-muted">{t('settings.repairHint')}</p>
          </div>

          <div className="rounded-tos-panel border border-tos-border bg-tos-tan/60 p-3">
            <button
              type="button"
              onClick={() => {
                void checkRuntimes()
                onClose()
              }}
              className={`font-display font-bold ${surfaceButton}`}
            >
              {t('settings.checkRuntimes')}
            </button>
            <p className="mt-2 text-xs text-tos-brown-muted">{t('settings.checkRuntimesHint')}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void window.yufa.appOpenLogs()}
            className="text-xs text-tos-burgundy underline-offset-2 hover:text-tos-red-hover hover:underline"
          >
            {t('settings.openLogs')}
          </button>
          <button type="button" onClick={onClose} className={surfaceButton}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
