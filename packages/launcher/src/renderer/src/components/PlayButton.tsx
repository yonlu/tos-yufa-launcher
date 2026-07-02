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
  const { patcher, progress, updater, settings, launching, startUpdate, check, play } = useLauncher()
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
        return { label: t('play.update'), onClick: () => void startUpdate(), disabled: false, variant: 'update' }
      case 'updating':
        return {
          label: t('play.updating', { percent }),
          disabled: true,
          variant: 'update',
          fillPercent: percent,
        }
      case 'verifying':
      case 'repairing':
        return { label: t('play.verifying'), disabled: true, variant: 'neutral', spinner: true }
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

  const palette = {
    play: 'bg-gradient-to-b from-amber-400 to-amber-600 text-amber-950 hover:from-amber-300 hover:to-amber-500 shadow-lg shadow-amber-900/40',
    update: 'bg-gradient-to-b from-sky-500 to-sky-700 text-white hover:from-sky-400 hover:to-sky-600 shadow-lg shadow-sky-900/40',
    neutral: 'bg-white/10 text-slate-200 hover:bg-white/15',
  }[spec.variant]

  return (
    <button
      type="button"
      onClick={spec.onClick}
      disabled={spec.disabled}
      className={`relative h-14 w-60 overflow-hidden rounded-xl text-base font-bold uppercase tracking-wider transition-all disabled:cursor-default ${palette} ${
        spec.disabled && spec.fillPercent === undefined ? 'opacity-70' : ''
      }`}
    >
      {spec.fillPercent !== undefined && (
        <span
          className="absolute inset-y-0 left-0 bg-white/25 transition-[width] duration-300"
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
