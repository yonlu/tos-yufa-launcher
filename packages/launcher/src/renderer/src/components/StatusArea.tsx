import { useTranslation } from 'react-i18next'
import { formatBytes, formatEta } from '../lib/format'
import { focusRing, monoLabel } from '../lib/ui'
import { useLauncher } from '../store'

/**
 * The second line of the stack: the revision as the site's uppercase data
 * label, other numbers (a size, a speed) in mono as they read, or a plain
 * note in body text.
 */
type Detail = { kind: 'revision' | 'mono' | 'note'; text: string } | null

/**
 * Beside Play: a two-line stack in the site's stat-sheet manner. The first
 * line says what the launcher is doing in words; the second is the number
 * that goes with it, in mono (the revision when ready, the size when an
 * update waits, the speed and time left while it downloads). Cancel sits
 * at the end of the first line while a download runs, and a hairline
 * progress bar under both while bytes move.
 */
export function StatusArea() {
  const { patcher, progress, cancel } = useLauncher()
  const { t } = useTranslation()

  const percent =
    progress && progress.overallTotal > 0 ? Math.min(100, (progress.overallBytes / progress.overallTotal) * 100) : 0
  const plan = patcher.plan

  let line: string | null = null
  let detail: Detail = null
  switch (patcher.state) {
    case 'checking':
      line = t('status.checking')
      break
    case 'up-to-date':
      line = t('status.upToDate')
      detail = { kind: 'revision', text: t('status.revision', { revision: plan?.targetRevision ?? '' }) }
      break
    case 'ready':
      line = t('status.ready')
      detail = { kind: 'revision', text: t('status.revision', { revision: plan?.targetRevision ?? '' }) }
      break
    case 'not-installed':
      line = t('status.notInstalled')
      detail = { kind: 'mono', text: t('status.download', { size: formatBytes(plan?.totalBytes ?? 0) }) }
      break
    case 'update-available':
      if ((plan?.fileCount ?? 0) > 0) {
        line = t(patcher.installIncomplete ? 'status.resumeAvailable' : 'status.updateAvailable')
        detail = { kind: 'mono', text: t('status.files', { count: plan?.fileCount ?? 0, size: formatBytes(plan?.totalBytes ?? 0) }) }
      } else {
        line = t('status.cleanupAvailable')
        detail = { kind: 'mono', text: t('status.filesToRemove', { count: plan?.deleteCount ?? 0 }) }
      }
      break
    case 'installing-runtimes':
      // downloading: the engine's per-file line; installing: tell the player the UAC prompt is coming
      if (patcher.redist?.status === 'downloading' && progress) {
        line = t('status.runtimes.downloading', { file: progress.file, index: progress.fileIndex, count: progress.fileCount })
      } else {
        line = t('status.runtimes.installing')
        detail = { kind: 'note', text: t('status.runtimes.elevation') }
      }
      break
    case 'installing':
    case 'updating':
    case 'repairing':
    case 'verifying':
      if (progress) {
        line = t(progress.phase === 'hashing' ? 'status.hashing' : 'status.updating', {
          file: progress.file,
          index: progress.fileIndex,
          count: progress.fileCount,
        })
        const parts = [`${Math.floor(percent)}%`]
        if (progress.phase === 'downloading' && progress.bytesPerSec > 0) {
          parts.push(t('status.speed', { speed: formatBytes(progress.bytesPerSec) }))
          if (progress.etaSec !== null) parts.push(t('status.eta', { eta: formatEta(progress.etaSec) }))
        }
        detail = { kind: 'mono', text: parts.join(' · ') }
      }
      break
    default:
      break
  }

  const active = patcher.state === 'installing' || patcher.state === 'updating'
  const runtimesDownloading = patcher.state === 'installing-runtimes' && patcher.redist?.status === 'downloading'
  const showBar = (active || patcher.state === 'repairing' || runtimesDownloading) && progress !== null

  if (!line) return null

  return (
    <div role="status" className="flex min-w-0 max-w-[380px] flex-1 flex-col gap-px">
      <p className="flex items-baseline gap-3 text-sm text-tos-brown">
        <span className="min-w-0 truncate">{line}</span>
        {active && (
          <button
            type="button"
            onClick={() => void cancel()}
            className={`shrink-0 text-xs text-tos-burgundy transition-colors hover:text-tos-red-hover ${focusRing}`}
          >
            {t('play.cancel')}
          </button>
        )}
      </p>
      {detail && (
        <p
          className={
            detail.kind === 'revision'
              ? monoLabel
              : detail.kind === 'mono'
                ? 'font-mono text-[11px] tracking-[0.05em] text-tos-brown-muted'
                : 'text-xs text-tos-brown-light'
          }
        >
          {detail.text}
        </p>
      )}
      {showBar && (
        <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-tos-border-dark/60" aria-hidden>
          <div className="h-full rounded-full bg-tos-burgundy transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}
