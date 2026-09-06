import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

/** A failed or declined Redistributable install: a warning next to Play, which stays enabled. */
export function RuntimeWarning() {
  const redist = useLauncher((s) => s.patcher.redist)
  const { t } = useTranslation()

  if (redist?.status !== 'failed') return null
  const reason = redist.error?.code === 'elevation-declined' ? 'declined' : 'failed'
  const runtimes = redist.missing.map((rt) => t(`redist.name.${rt}`)).join(', ')
  return (
    <div className="mx-8 mb-3 rounded-tos-panel border border-tos-orange-dark/40 bg-tos-cream/90 px-4 py-3 shadow-tos-panel backdrop-blur-sm">
      <p className="text-sm text-tos-brown">{t('redist.warning', { runtimes })}</p>
      <p className="mt-0.5 text-xs text-tos-brown-light">{t(`redist.reason.${reason}`)}</p>
      {redist.error?.message && (
        <p className="mt-0.5 break-all text-[10px] text-tos-brown-muted">{redist.error.message}</p>
      )}
    </div>
  )
}
