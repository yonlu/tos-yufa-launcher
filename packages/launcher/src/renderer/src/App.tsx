import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CommunityCard } from './components/CommunityCard'
import { CompatibilityFixPrompt } from './components/CompatibilityFixPrompt'
import { Hero } from './components/Hero'
import { HomeNews, NewsList, NewsStaleBadge } from './components/NewsGrid'
import { SettingsDialog } from './components/SettingsDialog'
import { TitleBar } from './components/TitleBar'
import { TopNav } from './components/TopNav'
import { UpdateToast } from './components/UpdateToast'
import './i18n'
import { settingsSectionFromView } from './lib/settingsDialog'
import { shellViewFromQuery, type ShellView } from './lib/shell'
import { installMockIfNeeded } from './mockYufa'
import { useLauncher } from './store'

installMockIfNeeded()

/**
 * `?view=` on start: `settings` or `settings:launcher` opens Settings at that section, `news` opens the News
 * view. The screenshot smoke (YUFA_VIEW in main) and the dev harness use it.
 */
const startQuery = new URLSearchParams(location.search).get('view')
const startSection = settingsSectionFromView(startQuery)
const startView = shellViewFromQuery(startQuery)

/**
 * The shell: title bar, the hero with the nav floating over it, and under
 * it either the home row (three news cards and the community card) or the
 * full news list. Settings, the launcher-update toast and the one-time AMD
 * prompt float over everything.
 */
export default function App() {
  const init = useLauncher((s) => s.init)
  const refreshCommunity = useLauncher((s) => s.refreshCommunity)
  const stale = useLauncher((s) => s.news?.stale ?? false)
  const [settingsOpen, setSettingsOpen] = useState(startSection !== null)
  const [view, setView] = useState<ShellView>(startView)
  const { t } = useTranslation()

  useEffect(() => {
    void init()
  }, [init])

  // the Discord counts: init fetched them once at start; again each time the player comes back Home, never on a timer
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) firstView.current = false
    else if (view === 'home') void refreshCommunity()
  }, [view, refreshCommunity])

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-tos-beige text-tos-brown">
      <TitleBar onOpenSettings={() => setSettingsOpen(true)} />

      <Hero collapsed={view === 'news'}>
        <TopNav view={view} onNavigate={setView} />
      </Hero>

      {view === 'home' ? (
        <div className="flex min-h-0 flex-1 flex-col px-12 pb-6 pt-2">
          {stale && (
            <p className="mb-1.5 flex justify-end">
              <NewsStaleBadge />
            </p>
          )}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_1fr_270px] gap-4">
            <HomeNews />
            <CommunityCard />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-12 pb-6 pt-4">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="font-display text-xl font-bold text-tos-burgundy">{t('news.title')}</h2>
            <NewsStaleBadge />
            <button
              type="button"
              onClick={() => setView('home')}
              className="ml-auto text-xs text-tos-brown-light underline-offset-2 hover:text-tos-burgundy hover:underline"
            >
              ← {t('news.back')}
            </button>
          </div>
          <NewsList />
        </div>
      )}

      <UpdateToast />
      <SettingsDialog open={settingsOpen} initialSection={startSection ?? 'game'} onClose={() => setSettingsOpen(false)} />
      <CompatibilityFixPrompt />
    </div>
  )
}
