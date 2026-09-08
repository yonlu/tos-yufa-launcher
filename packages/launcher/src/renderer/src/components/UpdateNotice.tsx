import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { textLink } from '../lib/ui'
import { useLauncher } from '../store'

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

/**
 * The launcher's own update, as one line in the top bar's empty middle:
 * downloading with its percent, then ready with Restart now. Nothing floats
 * over the page. A forced update (launcher-outdated) is Play's job instead.
 */
export function UpdateNotice() {
  const { updater, patcher } = useLauncher()
  const { t } = useTranslation()

  if (patcher.error?.code === 'launcher-outdated') return null
  if (updater.status !== 'downloading' && updater.status !== 'ready') return null

  return (
    <p style={NO_DRAG} role="status" className="mr-4 flex items-center gap-3 text-[13px] text-tos-brown-light">
      <span>{updater.status === 'ready' ? t('updater.ready') : t('updater.downloading', { percent: updater.percent ?? 0 })}</span>
      {updater.status === 'ready' && (
        <button type="button" onClick={() => void window.yufa.updaterInstall()} className={`font-medium ${textLink}`}>
          {t('updater.restart')}
        </button>
      )}
    </p>
  )
}
