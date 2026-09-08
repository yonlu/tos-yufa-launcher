import { useTranslation } from 'react-i18next'
import { DISCORD_INVITE_URL } from '@yufa/shared/links'
import { focusRing } from '../lib/ui'
import { useLauncher } from '../store'

/**
 * The Discord line, bottom right under the goddess: a green dot and who is
 * online now (via community:get), and a small Join button in Discord's
 * blue. Without counts (the fetch failed, or has not answered yet) the line
 * just names the place; Join always works.
 */
export function DiscordLine() {
  const community = useLauncher((s) => s.community)
  const { t, i18n } = useTranslation()

  return (
    <div className="absolute bottom-6 right-10 z-10 flex items-center gap-3.5">
      <p className="flex items-center gap-2 text-[13px] text-tos-brown">
        {community ? (
          <>
            <span aria-hidden className="h-2 w-2 rounded-full bg-tos-green shadow-[0_0_0_3px_rgba(130,168,0,0.18)]" />
            {t('community.online', { count: community.online.toLocaleString(i18n.language) })}
          </>
        ) : (
          t('community.blurb')
        )}
      </p>
      <button
        type="button"
        onClick={() => void window.yufa.appOpenExternal(DISCORD_INVITE_URL)}
        className={`h-[34px] rounded-[10px] bg-tos-discord px-4 text-[13px] font-bold text-white transition-colors hover:bg-tos-discord-hover ${focusRing}`}
      >
        {t('community.join')}
      </button>
    </div>
  )
}
