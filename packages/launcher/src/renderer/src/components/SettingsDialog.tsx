import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DxvkResult } from '@yufa/shared'
// the pin module alone: the package root would drag zod's schemas into the renderer bundle
import { DXVK_VERSION } from '@yufa/shared/dxvk'
import { amdAdapterName } from '../lib/compatibilityFix'
import { SETTINGS_SECTIONS, compatibilityFixRowResult, updaterControl, type SettingsSection } from '../lib/settingsDialog'
import { useLauncher } from '../store'
import { CompatibilityFixRefusal } from './CompatibilityFixRefusal'
import { Toggle } from './Toggle'

const field =
  'rounded-md border border-tos-input-border bg-tos-input-bg px-3 py-2 text-sm text-tos-brown outline-none focus:border-tos-orange'
const surfaceButton =
  'rounded-md bg-tos-tan px-3 py-2 text-sm text-tos-brown-light hover:bg-tos-border hover:text-tos-brown disabled:opacity-60'

/** One setting: title and a one-line hint on the left, its control on the right, anything that needs the full width under both. */
function Row({ title, hint, extra, note, children }: { title: string; hint?: string; extra?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-tos-border py-4 last:border-0">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-tos-brown">{title}</p>
          {hint && <p className="mt-0.5 text-xs text-tos-brown-light">{hint}</p>}
          {extra}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {note && <div className="mt-2">{note}</div>}
    </div>
  )
}

/**
 * Settings: a sidebar with the two sections and Close at its foot, and a
 * scrolling pane with one row per setting. Every control saves on change;
 * there is no Apply. Stays mounted while closed, so a refusal under the
 * Compatibility fix switch belongs to the visit it happened in.
 */
export function SettingsDialog({ open, initialSection, onClose }: { open: boolean; initialSection: SettingsSection; onClose: () => void }) {
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const settings = useLauncher((s) => s.settings)

  if (!open || !settings) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-labelledby="settings-title"
        className="animate-fade-up flex h-[540px] w-[860px] overflow-hidden rounded-tos-panel border border-tos-border bg-tos-cream opacity-0 shadow-xl [animation-duration:0.3s]"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-52 shrink-0 flex-col border-r border-tos-border bg-tos-tan p-4">
          <h2 id="settings-title" className="font-display mb-4 px-3 text-lg font-bold text-tos-burgundy">
            {t('settings.title')}
          </h2>
          <nav aria-label={t('settings.title')} className="flex flex-col gap-1">
            {SETTINGS_SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                aria-current={section === s ? 'page' : undefined}
                onClick={() => setSection(s)}
                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  section === s ? 'bg-tos-cream font-medium text-tos-burgundy shadow-tos-panel' : 'text-tos-brown-light hover:bg-tos-cream/60 hover:text-tos-brown'
                }`}
              >
                {t(`settings.section.${s}`)}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={onClose}
            className="mt-auto rounded-md border border-tos-border bg-tos-cream px-3 py-2 text-sm text-tos-brown-light hover:border-tos-border-dark hover:text-tos-brown"
          >
            {t('settings.close')}
          </button>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-5">
          <h3 className="font-display mb-1 text-base font-bold text-tos-burgundy">{t(`settings.section.${section}`)}</h3>
          {section === 'game' ? <GameSection open={open} onClose={onClose} /> : <LauncherSection />}
        </div>
      </div>
    </div>
  )
}

function GameSection({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { settings, gpu, patcher, saveSettings, selectGamePath, repair, checkRuntimes, setCompatibilityFix } = useLauncher()
  const [invalidPath, setInvalidPath] = useState(false)
  // the Compatibility fix switch: what the last enable or disable of this visit said, shown under its row
  const [fixResult, setFixResult] = useState<DxvkResult | null>(null)
  const [fixWorking, setFixWorking] = useState(false)
  useEffect(() => {
    if (!open) setFixResult(null)
  }, [open])

  if (!settings) return null

  async function browse(): Promise<void> {
    const result = await selectGamePath()
    if (result) setInvalidPath(!result.valid)
  }

  async function toggleFix(on: boolean): Promise<void> {
    setFixWorking(true)
    try {
      setFixResult(await setCompatibilityFix(on))
    } finally {
      setFixWorking(false)
    }
  }

  const adapter = amdAdapterName(gpu)
  const rowResult = compatibilityFixRowResult({ visit: fixResult, reconciled: patcher.dxvk, enabled: settings.amdCompatibilityEnabled })

  return (
    <>
      <Row
        title={t('settings.gamePath')}
        hint={t('settings.gamePathHint')}
        note={invalidPath && <p className="text-xs text-tos-burgundy">{t('settings.invalidPath')}</p>}
      >
        <input className={`${field} w-52`} value={settings.gamePath} readOnly title={settings.gamePath} />
        <button type="button" onClick={() => void browse()} className={surfaceButton}>
          {t('settings.browse')}
        </button>
      </Row>

      <Row title={t('settings.launchArgs')} hint={t('settings.launchArgsHint')}>
        <input
          className={`${field} w-52`}
          defaultValue={settings.launchArgs}
          onBlur={(e) => void saveSettings({ launchArgs: e.target.value })}
          spellCheck={false}
          aria-label={t('settings.launchArgs')}
        />
      </Row>

      <Row title={t('settings.afterLaunch')} hint={t('settings.afterLaunchHint')}>
        <select
          className={`${field} w-52`}
          value={settings.afterLaunch}
          onChange={(e) => void saveSettings({ afterLaunch: e.target.value as 'quit' | 'minimize' | 'stay' })}
          aria-label={t('settings.afterLaunch')}
        >
          <option value="quit">{t('settings.afterLaunch.quit')}</option>
          <option value="minimize">{t('settings.afterLaunch.minimize')}</option>
          <option value="stay">{t('settings.afterLaunch.stay')}</option>
        </select>
      </Row>

      <Row title={t('settings.allowOffline')} hint={t('settings.allowOfflineHint')}>
        <Toggle
          on={settings.allowOfflinePlay}
          onChange={(on) => void saveSettings({ allowOfflinePlay: on })}
          label={t('settings.allowOffline')}
        />
      </Row>

      <Row
        title={t('settings.amdFix')}
        hint={t('settings.amdFixHint')}
        extra={
          <>
            <p className="mt-1.5 text-xs text-tos-brown-light">{adapter ? t('dxvk.adapter', { name: adapter }) : t('settings.amdFixNoAdapter')}</p>
            <p className="mt-0.5 text-[10px] text-tos-brown-muted">{t('settings.amdFixAttribution', { version: DXVK_VERSION })}</p>
          </>
        }
        note={rowResult?.error && <CompatibilityFixRefusal result={rowResult} />}
      >
        <Toggle on={settings.amdCompatibilityEnabled} disabled={fixWorking} onChange={(on) => void toggleFix(on)} label={t('settings.amdFix')} />
      </Row>

      <Row title={t('settings.repair')} hint={t('settings.repairHint')}>
        <button
          type="button"
          onClick={() => {
            void repair()
            onClose()
          }}
          className={surfaceButton}
        >
          {t('settings.repairButton')}
        </button>
      </Row>

      <Row title={t('settings.checkRuntimes')} hint={t('settings.checkRuntimesHint')}>
        <button
          type="button"
          onClick={() => {
            void checkRuntimes()
            onClose()
          }}
          className={surfaceButton}
        >
          {t('settings.checkRuntimesButton')}
        </button>
      </Row>
    </>
  )
}

function LauncherSection() {
  const { t } = useTranslation()
  const { settings, restartRequired, version, updater, saveSettings, checkForLauncherUpdate } = useLauncher()
  if (!settings) return null

  const control = updaterControl(updater.status)

  return (
    <>
      <Row title={t('settings.language')} hint={t('settings.languageHint')}>
        <select
          className={`${field} w-52`}
          value={settings.language}
          onChange={(e) => void saveSettings({ language: e.target.value as 'pt-BR' | 'en' })}
          aria-label={t('settings.language')}
        >
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en">English</option>
        </select>
      </Row>

      <Row title={t('settings.downloadConcurrency')} hint={t('settings.downloadConcurrencyHint')}>
        <select
          className={`${field} w-52`}
          value={settings.downloadConcurrency}
          onChange={(e) => void saveSettings({ downloadConcurrency: Number(e.target.value) as 1 | 2 | 3 })}
          aria-label={t('settings.downloadConcurrency')}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
      </Row>

      <Row
        title={t('settings.hardwareAcceleration')}
        hint={t('settings.hardwareAccelerationHint')}
        note={restartRequired && <p className="text-xs text-tos-burgundy">{t('settings.restartRequired')}</p>}
      >
        <Toggle
          on={settings.hardwareAcceleration}
          onChange={(on) => void saveSettings({ hardwareAcceleration: on })}
          label={t('settings.hardwareAcceleration')}
        />
      </Row>

      <Row
        title={t('settings.launcherVersion', { version })}
        hint={t(`settings.updater.${updater.status}`, { version: updater.version ?? '', percent: updater.percent ?? 0 })}
      >
        {control.action === 'restart' ? (
          <button type="button" onClick={() => void window.yufa.updaterInstall()} className={`font-display font-bold ${surfaceButton}`}>
            {t('updater.restart')}
          </button>
        ) : (
          <button type="button" disabled={!control.enabled} onClick={() => void checkForLauncherUpdate()} className={surfaceButton}>
            {t('settings.checkNow')}
          </button>
        )}
      </Row>

      <Row title={t('settings.openLogs')} hint={t('settings.openLogsHint')}>
        <button type="button" onClick={() => void window.yufa.appOpenLogs()} className={surfaceButton}>
          {t('settings.openLogsButton')}
        </button>
      </Row>
    </>
  )
}
