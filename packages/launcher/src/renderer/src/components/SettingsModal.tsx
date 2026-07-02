import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, saveSettings, selectGamePath, repair } = useLauncher()
  const { t } = useTranslation()
  const [invalidPath, setInvalidPath] = useState(false)

  if (!open || !settings) return null

  const label = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400'
  const field =
    'w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-amber-400/50'

  async function browse() {
    const result = await selectGamePath()
    if (result) setInvalidPath(!result.valid)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[540px] rounded-xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-lg font-semibold text-slate-100">{t('settings.title')}</h2>

        <div className="space-y-4">
          <div>
            <label className={label}>{t('settings.gamePath')}</label>
            <div className="flex gap-2">
              <input className={`${field} flex-1`} value={settings.gamePath} readOnly />
              <button
                type="button"
                onClick={() => void browse()}
                className="shrink-0 rounded-md bg-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/15"
              >
                {t('settings.browse')}
              </button>
            </div>
            {invalidPath && <p className="mt-1 text-xs text-red-400">{t('settings.invalidPath')}</p>}
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

          <div>
            <label className={label}>{t('settings.launchArgs')}</label>
            <input
              className={field}
              defaultValue={settings.launchArgs}
              onBlur={(e) => void saveSettings({ launchArgs: e.target.value })}
              spellCheck={false}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={settings.allowOfflinePlay}
              onChange={(e) => void saveSettings({ allowOfflinePlay: e.target.checked })}
              className="h-4 w-4 accent-amber-500"
            />
            {t('settings.allowOffline')}
          </label>

          <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
            <button
              type="button"
              onClick={() => {
                void repair()
                onClose()
              }}
              className="rounded-md bg-sky-600/80 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
            >
              {t('settings.repair')}
            </button>
            <p className="mt-2 text-xs text-slate-500">{t('settings.repairHint')}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void window.yufa.appOpenLogs()}
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
          >
            {t('settings.openLogs')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/15"
          >
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
