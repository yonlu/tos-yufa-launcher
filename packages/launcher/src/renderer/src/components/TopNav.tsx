import { useTranslation } from 'react-i18next'
// the links subpath alone: the package root would drag zod into the renderer bundle
import { DATABASE_URL, DISCORD_INVITE_URL, PLANNER_URL, SITE_URL } from '@yufa/shared/links'
import logoUrl from '../assets/logo.webp'
import type { ShellView } from '../lib/shell'

/** The nav's right half: the site and its tools, opened in the player's browser. */
const EXTERNAL = [
  { key: 'site', href: SITE_URL },
  { key: 'discord', href: DISCORD_INVITE_URL },
  { key: 'database', href: DATABASE_URL },
  { key: 'planner', href: PLANNER_URL },
] as const

const pill = 'rounded-full px-3.5 py-1.5 text-xs font-medium tracking-wide transition-colors'
const idle = 'text-tos-brown hover:bg-tos-tan hover:text-tos-burgundy'

/**
 * The floating pill nav over the hero: Home and News on the left switch the
 * view, the site links on the right leave the launcher. The logo sits over
 * the middle of the pill and breaks out above it. The pill is three columns
 * with the spacer in the middle one and a fixed overall width: with the
 * width definite the two outer columns come out equal, so the spacer, and
 * the logo over it, sit at the pill's centre whatever the link labels
 * measure in either language. (Left to shrink-wrap, Chrome sizes the outer
 * columns to their contents and the logo drifts onto Site.)
 */
export function TopNav({ view, onNavigate }: { view: ShellView; onNavigate: (view: ShellView) => void }) {
  const { t } = useTranslation()

  const viewLink = (target: ShellView) => {
    const active = view === target
    return (
      <button
        key={target}
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => onNavigate(target)}
        className={`${pill} ${active ? 'bg-tos-burgundy text-white shadow-sm' : idle}`}
      >
        {t(`nav.${target}`)}
      </button>
    )
  }

  return (
    <nav className="absolute left-1/2 top-[76px] z-20 -translate-x-1/2">
      <div className="grid w-[740px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-full border border-white/40 bg-tos-cream/90 px-2 py-1 shadow-lg backdrop-blur-md">
        <div className="flex justify-end gap-1">
          {viewLink('home')}
          {viewLink('news')}
        </div>
        <span aria-hidden className="w-36" />
        <div className="flex gap-1">
          {EXTERNAL.map((link) => (
            <button
              key={link.key}
              type="button"
              onClick={() => void window.yufa.appOpenExternal(link.href)}
              className={`${pill} ${idle}`}
            >
              {t(`nav.${link.key}`)}
            </button>
          ))}
        </div>
      </div>
      <img
        src={logoUrl}
        alt="Yufa"
        className="pointer-events-none absolute left-1/2 top-1/2 h-20 w-auto -translate-x-1/2 -translate-y-[58%] drop-shadow-[0_6px_12px_rgba(0,0,0,0.45)]"
      />
    </nav>
  )
}
