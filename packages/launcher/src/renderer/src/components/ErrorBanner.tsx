import { useTranslation } from 'react-i18next'
import { errorBannerShown } from '../lib/shell'
import { useLauncher } from '../store'

export function ErrorBanner() {
  const patcher = useLauncher((s) => s.patcher)
  const { t } = useTranslation()

  if (!errorBannerShown(patcher)) return null
  const { code, message } = patcher.error!

  return (
    <div className="max-w-3xl rounded-tos-panel border border-tos-burgundy/40 bg-tos-cream/95 px-4 py-3 shadow-lg backdrop-blur-sm">
      <p className="text-sm text-tos-burgundy">{t(`error.${code}`)}</p>
      {code === 'offline' && patcher.offlinePlayable && (
        <p className="mt-0.5 text-xs text-tos-burgundy/70">{t('error.offlinePlayable')}</p>
      )}
      {message && <p className="mt-0.5 break-all text-[10px] text-tos-brown-muted">{message}</p>}
    </div>
  )
}
