import { useTranslation } from 'react-i18next'
import { useLauncher } from '../store'

export function ErrorBanner() {
  const patcher = useLauncher((s) => s.patcher)
  const { t } = useTranslation()

  if (patcher.state !== 'error' || !patcher.error) return null
  const { code, message } = patcher.error

  return (
    <div className="mx-8 mb-3 rounded-lg border border-red-500/25 bg-red-950/40 px-4 py-3">
      <p className="text-sm text-red-200">{t(`error.${code}`)}</p>
      {code === 'offline' && patcher.offlinePlayable && (
        <p className="mt-0.5 text-xs text-red-300/70">{t('error.offlinePlayable')}</p>
      )}
      {message && <p className="mt-0.5 break-all text-[10px] text-red-400/50">{message}</p>}
    </div>
  )
}
