import { useTranslation } from 'react-i18next'
import { runtimeWarningShown } from '../lib/shell'
import { useLauncher } from '../store'
import { WarningPanel } from './WarningPanel'

/** A failed or declined Redistributable install: a warning next to Play, which stays enabled. */
export function RuntimeWarning() {
  const patcher = useLauncher((s) => s.patcher)
  const { t } = useTranslation()

  if (!runtimeWarningShown(patcher)) return null
  const redist = patcher.redist!
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
