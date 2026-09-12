import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
// the links subpath alone: the package root would drag zod into the renderer bundle
import { DATABASE_URL, DISCORD_INVITE_URL, PLANNER_URL, SITE_URL } from '@yufa/shared/links'
import logoUrl from '../assets/logo.webp'
import type { ShellView } from '../lib/shell'
import { DRAG, NO_DRAG, focusRing } from '../lib/ui'
import { NavLink } from './NavLink'
import { UpdateNotice } from './UpdateNotice'

/** The nav's right half: the site and its tools, opened in the player's browser. */
const EXTERNAL = [
  { key: 'site', href: SITE_URL },
  { key: 'database', href: DATABASE_URL },
  { key: 'planner', href: PLANNER_URL },
  { key: 'discord', href: DISCORD_INVITE_URL },
] as const

function IconButton({
  onClick,
  label,
  active = false,
  danger = false,
  children,
}: {
  onClick: () => void
  label: string
  active?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={`flex h-[30px] w-9 items-center justify-center rounded-md transition-colors ${focusRing} ${
        danger
          ? 'text-tos-brown-light hover:bg-tos-burgundy hover:text-tos-cream'
          : active
            ? 'bg-tos-tan text-tos-orange-dark'
            : 'text-tos-brown-light hover:bg-tos-tan hover:text-tos-brown'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * The frameless window's chrome, a bare 68 px row on the parchment: the
 * logo, the nav as a text row (Home and News switch the view; the site and
 * its tools open in the browser), the launcher-update notice when there is
 * one, then Settings, minimize and close. The whole row drags the window
 * except what is clickable. Settings is a view like the other two; its
 * button reads as pressed while it is up, and pressing it again goes Home.
 */
export function TopBar({ view, onNavigate }: { view: ShellView; onNavigate: (view: ShellView) => void }) {
  const { t } = useTranslation()
  return (
    <header style={DRAG} className="relative z-10 flex h-[68px] shrink-0 items-center gap-5 pl-10 pr-3">
      <img src={logoUrl} alt="ToS Classic" width={43} height={44} className="h-11 w-auto" />
      <nav style={NO_DRAG} aria-label={t('nav.label')} className="ml-5 flex items-center gap-[22px]">
        <NavLink active={view === 'home'} onClick={() => onNavigate('home')}>
          {t('nav.home')}
        </NavLink>
        <NavLink active={view === 'news'} onClick={() => onNavigate('news')}>
          {t('nav.news')}
        </NavLink>
        <span aria-hidden className="h-4 w-px bg-tos-border-dark" />
        {EXTERNAL.map((link) => (
          <NavLink key={link.key} onClick={() => void window.yufa.appOpenExternal(link.href)}>
            {t(`nav.${link.key}`)}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1" />
      <UpdateNotice />
      <div style={NO_DRAG} className="flex items-center gap-0.5">
        <IconButton
          onClick={() => onNavigate(view === 'settings' ? 'home' : 'settings')}
          active={view === 'settings'}
          label={t('titlebar.settings')}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </IconButton>
        <IconButton onClick={() => window.yufa.windowMinimize()} label={t('titlebar.minimize')}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </IconButton>
        <IconButton onClick={() => window.yufa.windowClose()} danger label={t('titlebar.close')}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </IconButton>
      </div>
    </header>
  )
}
