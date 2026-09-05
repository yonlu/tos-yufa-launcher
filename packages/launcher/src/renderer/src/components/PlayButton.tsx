import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

interface ButtonSpec {
  label: string
  onClick?: () => void
  disabled: boolean
  variant: 'play' | 'update' | 'neutral'
  spinner?: boolean
  fillPercent?: number
}

/** The single morphing call-to-action: check → update (with progress fill) → play. */
export function PlayButton() {
  const {
    patcher,
    progress,
    updater,
    settings,
    launching,
    installPath,
    installCheck,
    installChecking,
    startUpdate,
    startInstall,
    check,
    play,
  } = useLauncher()
  const { t } = useTranslation()

  const percent =
    progress && progress.overallTotal > 0
      ? Math.min(100, Math.floor((progress.overallBytes / progress.overallTotal) * 100))
      : 0

  const spec: ButtonSpec = (() => {
    if (launching) return { label: t('play.launching'), disabled: true, variant: 'play', spinner: true }
    switch (patcher.state) {
      case 'idle':
      case 'checking':
        return { label: t('play.checking'), disabled: true, variant: 'neutral', spinner: true }
      case 'update-available':
        return {
          label: t(patcher.installIncomplete ? 'play.resume' : 'play.update'),
          onClick: () => void startUpdate(),
          disabled: false,
          variant: 'update',
        }
      case 'not-installed': {
        // enabled only once the main process judged the folder in the field ok
        const judged = installCheck && installCheck.path === installPath ? installCheck : null
        const label =
          judged?.existing === 'partial' ? 'play.resume' : judged?.existing === 'complete' ? 'play.useFolder' : 'play.install'
        return {
          label: t(label),
          onClick: () => void startInstall(),
          disabled: installChecking || !judged?.ok,
          variant: 'update',
        }
      }
      case 'installing':
      case 'updating':
        return {
          label: t(patcher.state === 'installing' ? 'play.installing' : 'play.updating', { percent }),
          disabled: true,
          variant: 'update',
          fillPercent: percent,
        }
      case 'verifying':
      case 'repairing':
        return { label: t('play.verifying'), disabled: true, variant: 'neutral', spinner: true }
      case 'installing-runtimes':
        return { label: t('play.installingRuntimes'), disabled: true, variant: 'neutral', spinner: true }
      case 'ready':
      case 'up-to-date':
        return { label: t('play.play'), onClick: () => void play(), disabled: false, variant: 'play' }
      case 'error': {
        const code = patcher.error?.code
        if (code === 'offline' && patcher.offlinePlayable && settings?.allowOfflinePlay) {
          return { label: t('play.playOffline'), onClick: () => void play(), disabled: false, variant: 'play' }
        }
        if (code === 'launcher-outdated') {
          if (updater.status === 'ready') {
            return {
              label: t('play.updateLauncher'),
              onClick: () => void window.yufa.updaterInstall(),
              disabled: false,
              variant: 'update',
            }
          }
          return {
            label:
              updater.status === 'downloading'
                ? t('play.updaterDownloading', { percent: updater.percent ?? 0 })
                : t('play.updateLauncher'),
            disabled: true,
            variant: 'update',
            spinner: true,
          }
        }
        return { label: t('play.retry'), onClick: () => void check(), disabled: false, variant: 'neutral' }
      }
    }
  })()

  // The site's design system has one primary treatment (orange CTA) — play and
  // update both map to it; label + progress fill disambiguate.
  const tosPrimary =
    'border-2 border-tos-button-primary-border bg-gradient-to-b from-tos-orange-light via-tos-orange to-tos-orange-dark text-tos-brown shadow-tos-cta [text-shadow:0px_1px_0px_rgba(255,255,255,0.3)] enabled:hover:shadow-tos-cta-hover enabled:hover:-translate-y-0.5'
  const palette = {
    play: tosPrimary,
    update: tosPrimary,
    neutral:
      'border-2 border-tos-border-dark bg-tos-tan text-tos-brown-light enabled:hover:bg-tos-border enabled:hover:text-tos-brown',
  }[spec.variant]

  return (
    <button
      type="button"
      onClick={spec.onClick}
      disabled={spec.disabled}
      className={`font-display relative h-14 w-60 overflow-hidden rounded-tos-cta text-base font-bold uppercase tracking-wider transition-all disabled:cursor-default ${palette} ${
        spec.disabled && spec.fillPercent === undefined ? 'opacity-70' : ''
      }`}
    >
      {spec.fillPercent !== undefined && (
        <span
          className="absolute inset-y-0 left-0 bg-white/40 transition-[width] duration-300"
          style={{ width: `${spec.fillPercent}%` }}
        />
      )}
      <span className="relative flex items-center justify-center gap-2">
        {spec.spinner && <Spinner />}
        {spec.label}
      </span>
    </button>
  )
}
