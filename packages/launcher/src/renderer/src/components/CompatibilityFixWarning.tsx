import { useTranslation } from 'react-i18next'
import { dxvkReason } from '../lib/compatibilityFix'
import { compatibilityFixWarningShown } from '../lib/shell'
import { useLauncher } from '../store'
import { WarningPanel } from './WarningPanel'

/**
 * The Compatibility fix is switched on but could not be applied at ready or
 * before Play: a warning next to Play, which stays enabled. A foreign
 * `d3d9.dll` names its path so the player knows which file the launcher is
 * leaving alone. (What enable and disable from Settings report is shown
 * under the switch itself, not here.)
 */
export function CompatibilityFixWarning() {
  const patcher = useLauncher((s) => s.patcher)
  const { t } = useTranslation()

  if (!compatibilityFixWarningShown(patcher)) return null
  const reason = dxvkReason(patcher.dxvk)!
  return <WarningPanel title={t('dxvk.warning')} reason={t(`dxvk.reason.${reason}`)} detail={patcher.dxvk?.error?.message} />
}
