import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import logoUrl from '../assets/logo.png'
import { useLauncher } from '../store'

const DRAG = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

function IconButton({
  onClick,
  children,
  danger = false,
  title,
}: {
  onClick: () => void
  children: ReactNode
  danger?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-10 items-center justify-center rounded text-sm text-tos-brown-light transition-colors ${
        danger ? 'hover:bg-tos-burgundy hover:text-white' : 'hover:bg-tos-tan hover:text-tos-burgundy'
      }`}
    >
      {children}
    </button>
  )
}

export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const version = useLauncher((s) => s.version)
  const { t } = useTranslation()
  return (
    <header
      style={DRAG}
      className="flex h-10 shrink-0 items-center gap-3 border-b border-tos-border bg-tos-cream/85 pl-4 pr-1 shadow-sm backdrop-blur-md"
    >
      <img src={logoUrl} alt="" className="h-7 w-auto" />
      <span className="font-display text-xs font-bold tracking-wide text-tos-brown-light">{t('app.subtitle')}</span>
      {version && (
        <span className="ml-2 rounded bg-tos-tan px-1.5 py-0.5 text-[10px] text-tos-brown-muted">v{version}</span>
      )}
      <div style={NO_DRAG} className="ml-auto flex items-center">
        <IconButton onClick={onOpenSettings} title={t('titlebar.settings')}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </IconButton>
        <IconButton onClick={() => window.yufa.windowMinimize()} title={t('titlebar.minimize')}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </IconButton>
        <IconButton onClick={() => window.yufa.windowClose()} danger title={t('titlebar.close')}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </IconButton>
      </div>
    </header>
  )
}
