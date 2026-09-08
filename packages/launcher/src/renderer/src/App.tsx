import { useEffect, useRef, useState } from 'react'
import { Backdrop } from './components/Backdrop'
import { DiscordLine } from './components/DiscordLine'
import { HomeView } from './components/HomeView'
import { NewsView } from './components/NewsView'
import { SettingsView } from './components/SettingsView'
import { TopBar } from './components/TopBar'
import './i18n'
import { settingsSectionFromView, type SettingsSection } from './lib/settingsDialog'
import { shellViewFromQuery, type ShellView } from './lib/shell'
import { installMockIfNeeded } from './mockYufa'
import { useLauncher } from './store'

installMockIfNeeded()

/**
 * `?view=` on start: `settings` or `settings:launcher` opens Settings at that section, `news` opens the News
 * view. The screenshot smoke (YUFA_VIEW in main) and the dev harness use it.
 */
const startQuery = new URLSearchParams(location.search).get('view')
const startView = shellViewFromQuery(startQuery)
const startSection: SettingsSection = settingsSectionFromView(startQuery) ?? 'game'

/**
 * The shell: parchment everywhere, the goddess standing at the right edge,
 * the top bar with the logo, the nav and the window controls, and under it
 * one of three views (Home, News, Settings) in the left column. The Discord
 * line sits bottom right under the art in every view.
 */
export default function App() {
  const init = useLauncher((s) => s.init)
  const refreshCommunity = useLauncher((s) => s.refreshCommunity)
  const [view, setView] = useState<ShellView>(startView)
  // the section Settings opens at: the query's on the first visit, Game on every later one
  const [settingsStart, setSettingsStart] = useState<SettingsSection>(startSection)

  useEffect(() => {
    void init()
  }, [init])

  // the Discord counts: init fetched them once at start; again each time the player comes back Home, never on a timer
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) firstView.current = false
    else if (view === 'home') void refreshCommunity()
    if (view !== 'settings') setSettingsStart('game')
  }, [view, refreshCommunity])

  return (
    <div className="relative h-screen overflow-hidden bg-tos-beige text-tos-brown">
      <Backdrop aside={view !== 'home'} />
      <div className="relative flex h-full flex-col">
        <TopBar view={view} onNavigate={setView} />
        {view === 'home' && <HomeView onNavigate={setView} />}
        {view === 'news' && <NewsView />}
        {view === 'settings' && <SettingsView initialSection={settingsStart} onLeave={() => setView('home')} />}
      </div>
      <DiscordLine />
    </div>
  )
}
