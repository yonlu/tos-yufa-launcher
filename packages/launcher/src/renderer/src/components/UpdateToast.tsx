import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

/** Unobtrusive launcher self-update notice (forced updates are handled by PlayButton). */
export function UpdateToast() {
  const { updater, patcher } = useLauncher()
  const { t } = useTranslation()

  if (patcher.error?.code === 'launcher-outdated') return null
  if (updater.status !== 'downloading' && updater.status !== 'ready') return null

  return (
    <div className="pointer-events-auto fixed bottom-28 right-4 z-40 flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/95 px-4 py-2.5 shadow-xl">
      <p className="text-xs text-slate-300">
        {updater.status === 'ready'
          ? t('updater.ready')
          : t('updater.downloading', { percent: updater.percent ?? 0 })}
      </p>
      {updater.status === 'ready' && (
        <button
          type="button"
          onClick={() => void window.yufa.updaterInstall()}
          className="rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-400"
        >
          {t('updater.restart')}
        </button>
      )}
    </div>
  )
}
