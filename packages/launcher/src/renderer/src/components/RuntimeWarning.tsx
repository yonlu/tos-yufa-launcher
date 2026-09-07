import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'
import { WarningPanel } from './WarningPanel'

/** A failed or declined Redistributable install: a warning next to Play, which stays enabled. */
export function RuntimeWarning() {
  const redist = useLauncher((s) => s.patcher.redist)
  const { t } = useTranslation()

  if (redist?.status !== 'failed') return null
  const reason = redist.error?.code === 'elevation-declined' ? 'declined' : 'failed'
  const runtimes = redist.missing.map((rt) => t(`redist.name.${rt}`)).join(', ')
  return (
    <WarningPanel
      title={t('redist.warning', { runtimes })}
      reason={t(`redist.reason.${reason}`)}
      detail={redist.error?.message}
    />
  )
}
