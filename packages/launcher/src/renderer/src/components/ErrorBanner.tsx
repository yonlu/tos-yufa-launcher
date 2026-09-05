import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

export function ErrorBanner() {
  const patcher = useLauncher((s) => s.patcher)
  const { t } = useTranslation()

  if (patcher.state !== 'error' || !patcher.error) return null
  const { code, message } = patcher.error

  return (
    <div className="mx-8 mb-3 rounded-tos-panel border border-tos-burgundy/30 bg-tos-cream/90 px-4 py-3 shadow-tos-panel backdrop-blur-sm">
      <p className="text-sm text-tos-burgundy">{t(`error.${code}`)}</p>
      {code === 'offline' && patcher.offlinePlayable && (
        <p className="mt-0.5 text-xs text-tos-burgundy/70">{t('error.offlinePlayable')}</p>
      )}
      {message && <p className="mt-0.5 break-all text-[10px] text-tos-brown-muted">{message}</p>}
    </div>
  )
}
