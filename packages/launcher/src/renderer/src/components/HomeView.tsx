import { useTranslation } from 'react-i18next'
import { subtitleShown } from '../lib/shell'
import type { ShellView } from '../lib/shell'
import { useLauncher } from '../store'
import { CompatibilityFixPrompt, useCompatibilityFixPrompt } from './CompatibilityFixPrompt'
import { CompatibilityFixWarning } from './CompatibilityFixWarning'
import { ErrorBanner } from './ErrorBanner'
import { InstallPanel } from './InstallPanel'
import { HomeNews } from './NewsList'
import { PlayButton } from './PlayButton'
import { RuntimeWarning } from './RuntimeWarning'
import { StatusArea } from './StatusArea'

/**
 * Home: the left column of the parchment. The headline (the title in the
 * site's burgundy, the subtitle, the slot for whatever needs the player's
 * attention, then Play with its status beside it) and under it the news
 * as the site's dated list. The subtitle gives its place to the slot
 * (subtitleShown, and the one-time AMD prompt), so Play stays put; the
 * news takes what height is left and fades out at the bottom rather than
 * cutting a row.
 */
export function HomeView({ onNavigate }: { onNavigate: (view: ShellView) => void }) {
  const patcher = useLauncher((s) => s.patcher)
  const prompt = useCompatibilityFixPrompt()
  const { t } = useTranslation()
  const subtitle = subtitleShown(patcher) && !prompt.open

  return (
    <main className="flex min-h-0 flex-1 flex-col pb-4 pl-14 pt-16">
      <section className="w-[600px] shrink-0">
        <h1 className="font-display text-[54px] font-bold leading-[1.05] tracking-[-0.01em] text-tos-burgundy">
          {t('hero.titleTop')}
          <br />
          {t('hero.titleBottom')}
        </h1>
        {subtitle && <p className="mt-4 max-w-[470px] text-base leading-[1.55] text-tos-brown-light">{t('hero.subtitle')}</p>}
        <div className="mt-4 flex max-w-[470px] flex-col gap-3 empty:hidden">
          <InstallPanel />
          <CompatibilityFixPrompt prompt={prompt} />
          <RuntimeWarning />
          <CompatibilityFixWarning />
          <ErrorBanner />
        </div>
        <div className="mt-[30px] flex items-center gap-[22px]">
          <PlayButton />
          <StatusArea />
        </div>
      </section>
      <HomeNews onViewAll={() => onNavigate('news')} />
    </main>
  )
}
