import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

/** Unobtrusive launcher self-update notice (forced updates are handled by PlayButton). */
export function UpdateToast() {
  const { updater, patcher } = useLauncher()
  const { t } = useTranslation()

  if (patcher.error?.code === 'launcher-outdated') return null
  if (updater.status !== 'downloading' && updater.status !== 'ready') return null

  return (
    <div className="animate-fade-up pointer-events-auto fixed right-4 top-32 z-40 flex items-center gap-3 rounded-tos-panel border border-tos-border bg-tos-cream px-4 py-2.5 opacity-0 shadow-lg [animation-duration:0.4s]">
      <p className="text-xs text-tos-brown-light">
        {updater.status === 'ready'
          ? t('updater.ready')
          : t('updater.downloading', { percent: updater.percent ?? 0 })}
      </p>
      {updater.status === 'ready' && (
        <button
          type="button"
          onClick={() => void window.yufa.updaterInstall()}
          className="font-display rounded-tos-tab border-2 border-tos-button-primary-border bg-gradient-to-b from-tos-orange-light via-tos-orange to-tos-orange-dark px-2.5 py-1 text-xs font-bold text-tos-brown [text-shadow:0px_1px_0px_rgba(255,255,255,0.3)] hover:shadow-tos-cta-hover"
        >
          {t('updater.restart')}
        </button>
      )}
    </div>
  )
}
