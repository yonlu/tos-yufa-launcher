import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import headBg from '../assets/head_bg.webp'
import headLeaves from '../assets/head_leaves.webp'
import { heroHeadline } from '../lib/shell'
import { useLauncher } from '../store'
import { CompatibilityFixWarning } from './CompatibilityFixWarning'
import { ErrorBanner } from './ErrorBanner'
import { InstallPanel } from './InstallPanel'
import { PlayButton } from './PlayButton'
import { RuntimeWarning } from './RuntimeWarning'
import { StatusArea } from './StatusArea'

/**
 * The hero: the key art under a veil that fades into the parchment below
 * and running up under the title bar (40 px of the 460 are its),
 * the nav floating over it, and in its lower half the headline, the slot
 * for the install panel and the warnings, then Play with the status beside
 * it. Collapsed, only the art and the nav remain (the News view). The
 * headline gives way to what takes the slot (heroHeadline), so Play stays
 * in view.
 */
export function Hero({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  const patcher = useLauncher((s) => s.patcher)
  const { t } = useTranslation()
  const headline = heroHeadline(patcher)

  return (
    <section
      className={`relative shrink-0 overflow-hidden transition-[height] duration-500 ease-out ${collapsed ? 'h-[216px]' : 'h-[460px]'}`}
    >
      <img src={headBg} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_22%]" />
      <div
        className="animate-leaf-float absolute inset-0 bg-top bg-no-repeat opacity-25"
        style={{ backgroundImage: `url(${headLeaves})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-tos-beige" />
      {/* the headline and status sit bottom left, where the veil is thinnest: a second, sideways veil under them */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/10 to-transparent" />

      {children}

      {!collapsed && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col">
          {headline !== 'none' && (
            <div className="animate-fade-up px-12 opacity-0" style={{ animationDelay: '0.1s' }}>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.3em] text-tos-orange-light drop-shadow">
                {t('hero.eyebrow')}
              </p>
              <h1 className="font-display text-5xl font-bold tracking-tight text-white drop-shadow-lg">
                {t('hero.title')} <span className="text-tos-orange">{t('hero.highlight')}</span>
              </h1>
              {headline === 'full' && (
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/85 drop-shadow">{t('hero.subtitle')}</p>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-col gap-2 px-12 empty:mt-0">
            <InstallPanel />
            <RuntimeWarning />
            <CompatibilityFixWarning />
            <ErrorBanner />
          </div>
          <div className="animate-fade-up flex items-center gap-6 px-12 pb-6 pt-3 opacity-0" style={{ animationDelay: '0.2s' }}>
            <PlayButton />
            <StatusArea />
          </div>
        </div>
      )}
    </section>
  )
}
