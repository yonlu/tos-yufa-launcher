import { useTranslation } from 'react-i18next'
import { errorBannerShown } from '../lib/shell'
import { useLauncher } from '../store'
import { Notice } from './Notice'

/** An error state with something to say, in the subtitle's place. Play becomes Try again, or Play offline. */
export function ErrorBanner() {
  const patcher = useLauncher((s) => s.patcher)
  const { t } = useTranslation()

  if (!errorBannerShown(patcher)) return null
  const { code, message } = patcher.error!

  return (
    <Notice
      tone="error"
      title={t(`error.${code}`)}
      reason={code === 'offline' && patcher.offlinePlayable ? t('error.offlinePlayable') : undefined}
      detail={message}
    />
  )
}
