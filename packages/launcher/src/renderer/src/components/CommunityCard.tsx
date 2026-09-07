import { useTranslation } from 'react-i18next'
import { DISCORD_INVITE_URL } from '@yufa/shared/links'
import { useLauncher } from '../store'

/**
 * The community card at the end of the home row: who is on the Discord now
 * and how many joined, and Join. Without counts (the fetch failed, or has
 * not answered yet) the numbers are simply absent; Join always works.
 */
export function CommunityCard() {
  const community = useLauncher((s) => s.community)
  const { t, i18n } = useTranslation()
  const format = (n: number): string => n.toLocaleString(i18n.language)

  return (
    <aside className="flex flex-col rounded-tos-panel border border-tos-border bg-gradient-to-br from-discord/8 to-discord/2 p-4 shadow-tos-panel">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-tos-brown-light">{t('community.title')}</p>
      {community ? (
        <>
          <p className="font-display mt-2 flex items-baseline gap-2 text-3xl font-bold text-tos-brown">
            <span aria-hidden className="inline-block h-2.5 w-2.5 self-center rounded-full bg-tos-green shadow-[0_0_0_3px_rgba(130,168,0,0.2)]" />
            {format(community.online)}
          </p>
          <p className="text-xs text-tos-brown-light">
            {t('community.online')} · {format(community.members)} {t('community.members')}
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-tos-brown-light">{t('community.blurb')}</p>
      )}
      <button
        type="button"
        onClick={() => void window.yufa.appOpenExternal(DISCORD_INVITE_URL)}
        className="mt-auto rounded-md bg-discord px-3 py-2 text-xs font-bold text-white shadow-sm transition-[filter,transform] hover:-translate-y-px hover:brightness-110"
      >
        {t('community.join')}
      </button>
    </aside>
  )
}
