import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'
import { WarningPanel } from './WarningPanel'

/** Reasons the warning names one by one; anything else falls back to the generic line. */
const NAMED_REASONS = new Set(['foreign-dll', 'game-running', 'file-locked', 'busy'])

/**
 * The Compatibility fix is switched on but could not be applied at ready or
 * before Play: a warning next to Play, which stays enabled. A foreign
 * `d3d9.dll` names its path so the player knows which file the launcher is
 * leaving alone. (What enable and disable from Settings report is shown
 * under the switch itself, not here.)
 */
export function CompatibilityFixWarning() {
  const dxvk = useLauncher((s) => s.patcher.dxvk)
  const { t } = useTranslation()

  if (!dxvk?.error) return null
  const code = dxvk.error.code
  const reason = NAMED_REASONS.has(code) ? code : 'failed'
  return <WarningPanel title={t('dxvk.warning')} reason={t(`dxvk.reason.${reason}`)} detail={dxvk.error.message} />
}
