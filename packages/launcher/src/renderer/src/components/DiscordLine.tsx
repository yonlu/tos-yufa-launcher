import { useTranslation } from 'react-i18next'
import { DISCORD_INVITE_URL } from '@yufa/shared/links'
import { focusRing } from '../lib/ui'
import { useLauncher } from '../store'

/** Discord's mark (the Clyde face), white on the button; the button's text names it, so the mark is decorative. */
function DiscordMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

/**
 * The Discord line, bottom right under the goddess: a green dot and who is
 * online now (via community:get), and a small Join button in Discord's
 * blue with Discord's mark on it, so it reads as Discord before the word.
 * Without counts (the fetch failed, or has not answered yet) the line just
 * names the place; Join always works.
 */
export function DiscordLine() {
  const community = useLauncher((s) => s.community)
  const { t, i18n } = useTranslation()

  return (
    <div className="absolute bottom-6 right-10 z-10 flex items-center gap-3.5">
      <p className="flex items-center gap-2 text-[13px] text-tos-brown">
        {community ? (
          <>
            <span aria-hidden className="h-2 w-2 rounded-full bg-tos-green ring-[3px] ring-tos-green/20" />
            {t('community.online', { count: community.online.toLocaleString(i18n.language) })}
          </>
        ) : (
          t('community.blurb')
        )}
      </p>
      <button
        type="button"
        onClick={() => void window.yufa.appOpenExternal(DISCORD_INVITE_URL)}
        className={`flex h-[34px] items-center gap-2 rounded-tos-panel bg-tos-discord pl-3 pr-4 text-[13px] font-bold text-white transition-colors hover:bg-tos-discord-hover ${focusRing}`}
      >
        <DiscordMark />
        {t('community.join')}
      </button>
    </div>
  )
}
