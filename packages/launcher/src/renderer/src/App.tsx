import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBanner } from './components/ErrorBanner'
import { NewsPanel } from './components/NewsPanel'
import { PlayButton } from './components/PlayButton'
import { SettingsModal } from './components/SettingsModal'
import { StatusArea } from './components/StatusArea'
import { TitleBar } from './components/TitleBar'
import { UpdateToast } from './components/UpdateToast'
import './i18n'
import { installMockIfNeeded } from './mockYufa'
import { useLauncher } from './store'

installMockIfNeeded()

export default function App() {
  const init = useLauncher((s) => s.init)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useTranslation() // re-render on language change

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-200">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(1000px_500px_at_20%_-10%,rgba(56,130,246,0.14),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(800px_400px_at_85%_110%,rgba(245,158,11,0.10),transparent)]" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <TitleBar onOpenSettings={() => setSettingsOpen(true)} />

        <main className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col justify-end">
            <div className="px-8 pb-6 pt-10">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-400/80">
                Tree of Savior
              </p>
              <h1 className="mt-1 text-5xl font-black tracking-tight text-slate-50 drop-shadow">
                YUFA <span className="text-amber-400">CLASSIC</span>
              </h1>
            </div>
            <ErrorBanner />
          </section>
          <NewsPanel />
        </main>

        <footer className="flex h-24 shrink-0 items-center border-t border-white/5 bg-black/40 px-8">
          <StatusArea />
          <PlayButton />
        </footer>
      </div>

      <UpdateToast />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
