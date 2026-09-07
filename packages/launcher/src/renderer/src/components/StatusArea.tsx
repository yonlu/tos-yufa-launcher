import { useTranslation } from 'react-i18next'
import { formatBytes, formatEta } from '../lib/format'
import { useLauncher } from '../store'

/** Beside Play in the hero: one-line status, live progress bar, cancel link, all over the dark veil. */
export function StatusArea() {
  const { patcher, progress, cancel } = useLauncher()
  const { t } = useTranslation()

  const percent =
    progress && progress.overallTotal > 0
      ? Math.min(100, (progress.overallBytes / progress.overallTotal) * 100)
      : 0

  let statusLine: string | null = null
  switch (patcher.state) {
    case 'checking':
      statusLine = t('status.checking')
      break
    case 'up-to-date':
      statusLine = t('status.upToDate', { revision: patcher.plan?.targetRevision ?? '' })
      break
    case 'ready':
      statusLine = t('status.ready', { revision: patcher.plan?.targetRevision ?? '' })
      break
    case 'not-installed':
      statusLine = t('status.notInstalled', { size: formatBytes(patcher.plan?.totalBytes ?? 0) })
      break
    case 'update-available':
      statusLine =
        (patcher.plan?.fileCount ?? 0) > 0
          ? t(patcher.installIncomplete ? 'status.resumeAvailable' : 'status.updateAvailable', {
              count: patcher.plan?.fileCount ?? 0,
              size: formatBytes(patcher.plan?.totalBytes ?? 0),
            })
          : t('status.cleanupAvailable', { count: patcher.plan?.deleteCount ?? 0 })
      break
    case 'installing-runtimes':
      // downloading: the engine's per-file line; installing: tell the player the UAC prompt is coming
      statusLine =
        patcher.redist?.status === 'downloading' && progress
          ? t('status.runtimes.downloading', { file: progress.file, index: progress.fileIndex, count: progress.fileCount })
          : t('status.runtimes.installing')
      break
    case 'installing':
    case 'updating':
    case 'repairing':
    case 'verifying':
      if (progress) {
        statusLine = t(progress.phase === 'hashing' ? 'status.hashing' : 'status.updating', {
          file: progress.file,
          index: progress.fileIndex,
          count: progress.fileCount,
        })
      }
      break
    default:
      statusLine = null
  }

  const active = patcher.state === 'installing' || patcher.state === 'updating'
  const runtimesDownloading = patcher.state === 'installing-runtimes' && patcher.redist?.status === 'downloading'
  const showBar = (active || patcher.state === 'repairing' || runtimesDownloading) && progress
  const showSpeed = showBar && progress!.phase === 'downloading' && progress!.bytesPerSec > 0

  return (
    <div className="flex min-w-0 max-w-xl flex-1 flex-col justify-center gap-1.5">
      <div className="flex items-baseline gap-3">
        {statusLine && <p className="truncate text-sm text-white drop-shadow">{statusLine}</p>}
        {showSpeed && (
          <p className="shrink-0 text-xs text-white/60 drop-shadow">
            {t('status.speed', {
              speed: formatBytes(progress!.bytesPerSec),
              eta: progress!.etaSec !== null ? formatEta(progress!.etaSec) : '…',
            })}
          </p>
        )}
        {active && (
          <button
            type="button"
            onClick={() => void cancel()}
            className="shrink-0 text-xs text-white/70 underline-offset-2 hover:text-white hover:underline"
          >
            {t('play.cancel')}
          </button>
        )}
      </div>
      {showBar && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/20 shadow-inner">
          <div
            className="h-full rounded-full bg-gradient-to-r from-tos-orange-light to-tos-orange transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}
