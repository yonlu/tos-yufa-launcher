import { useTranslation } from 'react-i18next'
import { formatBytes, formatEta } from '../lib/format'
import { useLauncher } from '../store'

/** Bottom-left: one-line status, live progress bar, cancel link. */
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
    case 'update-available':
      statusLine = t('status.updateAvailable', {
        count: patcher.plan?.fileCount ?? 0,
        size: formatBytes(patcher.plan?.totalBytes ?? 0),
      })
      break
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

  const showBar = (patcher.state === 'updating' || patcher.state === 'repairing') && progress
  const showSpeed = showBar && progress!.phase === 'downloading' && progress!.bytesPerSec > 0

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 pr-8">
      <div className="flex items-baseline gap-3">
        {statusLine && <p className="truncate text-sm text-slate-300">{statusLine}</p>}
        {showSpeed && (
          <p className="shrink-0 text-xs text-slate-500">
            {t('status.speed', {
              speed: formatBytes(progress!.bytesPerSec),
              eta: progress!.etaSec !== null ? formatEta(progress!.etaSec) : '…',
            })}
          </p>
        )}
        {patcher.state === 'updating' && (
          <button
            type="button"
            onClick={() => void cancel()}
            className="shrink-0 text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
          >
            {t('play.cancel')}
          </button>
        )}
      </div>
      {showBar && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-400 transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}
