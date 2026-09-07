import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import headBg from './assets/head_bg.webp'
import headLeaves from './assets/head_leaves.webp'
import { CompatibilityFixPrompt } from './components/CompatibilityFixPrompt'
import { CompatibilityFixWarning } from './components/CompatibilityFixWarning'
import { ErrorBanner } from './components/ErrorBanner'
import { InstallPanel } from './components/InstallPanel'
import { NewsPanel } from './components/NewsPanel'
import { PlayButton } from './components/PlayButton'
import { RuntimeWarning } from './components/RuntimeWarning'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusArea } from './components/StatusArea'
import { TitleBar } from './components/TitleBar'
import { UpdateToast } from './components/UpdateToast'
import './i18n'
import { settingsSectionFromView } from './lib/settingsDialog'
import { installMockIfNeeded } from './mockYufa'
import { useLauncher } from './store'

installMockIfNeeded()

/** `?view=settings` or `settings:launcher` opens Settings on start: the screenshot smoke (YUFA_VIEW in main) and the dev harness use it. */
const startSection = settingsSectionFromView(new URLSearchParams(location.search).get('view'))

export default function App() {
  const init = useLauncher((s) => s.init)
  const [settingsOpen, setSettingsOpen] = useState(startSection !== null)
  const { t } = useTranslation()

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-tos-beige text-tos-brown">
      {/* backdrop: hero photo fading into parchment, ambient leaves on top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bottom-24">
        <img src={headBg} alt="" className="h-full w-full object-cover object-[center_20%]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/10 to-tos-beige" />
        <div
          className="animate-leaf-float absolute inset-0 bg-top bg-no-repeat opacity-40"
          style={{ backgroundImage: `url(${headLeaves})` }}
        />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <TitleBar onOpenSettings={() => setSettingsOpen(true)} />

        <main className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col justify-end">
            <div className="animate-fade-up px-8 pb-6 pt-10 opacity-0" style={{ animationDelay: '0.1s' }}>
              <h1 className="font-display text-5xl font-bold tracking-tight text-tos-brown drop-shadow-sm">
                {t('hero.title')} <span className="text-tos-orange">{t('hero.highlight')}</span>
              </h1>
            </div>
            <InstallPanel />
            <RuntimeWarning />
            <CompatibilityFixWarning />
            <ErrorBanner />
          </section>
          <div className="animate-fade-up flex opacity-0" style={{ animationDelay: '0.3s' }}>
            <NewsPanel />
          </div>
        </main>

        <footer
          className="animate-fade-up flex h-24 shrink-0 items-center border-t border-tos-border bg-tos-cream px-8 opacity-0"
          style={{ animationDelay: '0.2s' }}
        >
          <StatusArea />
          <PlayButton />
        </footer>
      </div>

      <UpdateToast />
      <SettingsDialog open={settingsOpen} initialSection={startSection ?? 'game'} onClose={() => setSettingsOpen(false)} />
      <CompatibilityFixPrompt />
    </div>
  )
}
