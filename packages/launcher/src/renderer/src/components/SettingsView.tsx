import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DxvkResult, Settings } from '@yufa/shared'
// the pin module alone: the package root would drag zod's schemas into the renderer bundle
import { DXVK_VERSION } from '@yufa/shared/dxvk'
import { amdAdapterName } from '../lib/compatibilityFix'
import { SETTINGS_SECTIONS, compatibilityFixRowResult, updaterControl, type SettingsSection } from '../lib/settingsDialog'
import { field, surfaceButton } from '../lib/ui'
import { useLauncher } from '../store'
import { CompatibilityFixRefusal } from './CompatibilityFixRefusal'
import { Toggle } from './Toggle'
import { NavLink } from './TopBar'

/** One setting: title and a one-line hint on the left, its control on the right, anything that needs the full width under both. */
function Row({ title, hint, extra, note, children }: { title: string; hint: string; extra?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-tos-border py-4 last:border-0">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-tos-brown">{title}</p>
          <p className="mt-0.5 text-[13px] leading-[1.45] text-tos-brown-light">{hint}</p>
          {extra}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {note && <div className="mt-2">{note}</div>}
    </div>
  )
}

/** What the Game section has said during this visit. Kept by the view, so a trip to the other section does not lose it. */
interface GameVisit {
  /** Browse picked a folder without a game in it. */
  invalidPath: boolean
  /** The Compatibility fix switch: what the last enable or disable said, shown under its row. */
  fixResult: DxvkResult | null
  fixWorking: boolean
}
const FRESH_VISIT: GameVisit = { invalidPath: false, fixResult: null, fixWorking: false }

/**
 * Settings, a view like Home and News rather than a dialog over them: the
 * heading with the two sections as text links beside it, and under it one
 * row per setting, scrolling. Every control saves on change; there is no
 * Apply. Leaving the view (the nav, the gear, Escape, or an action that
 * takes the player back to Play) ends the visit: the next one opens at the
 * start section with nothing left over (a refusal under the Compatibility
 * fix switch, an invalid folder).
 */
export function SettingsView({ initialSection, onLeave }: { initialSection: SettingsSection; onLeave: () => void }) {
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [visit, setVisit] = useState<GameVisit>(FRESH_VISIT)
  const settings = useLauncher((s) => s.settings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onLeave()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onLeave])

  if (!settings) return null

  return (
    <main className="flex min-h-0 flex-1 flex-col pb-4 pl-14 pt-8">
      <div className="flex w-[600px] shrink-0 items-baseline justify-between border-b border-tos-border-dark pb-3">
        <h1 className="font-display text-[34px] font-bold leading-none text-tos-burgundy">{t('settings.title')}</h1>
        <nav aria-label={t('settings.title')} className="flex items-center gap-[22px]">
          {SETTINGS_SECTIONS.map((s) => (
            <NavLink key={s} active={section === s} onClick={() => setSection(s)}>
              {t(`settings.section.${s}`)}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="min-h-0 w-[600px] flex-1 overflow-y-auto pr-3">
        {section === 'game' ? (
          <GameSection visit={visit} onVisit={(patch) => setVisit((v) => ({ ...v, ...patch }))} onLeave={onLeave} />
        ) : (
          <LauncherSection />
        )}
      </div>
    </main>
  )
}

function GameSection({ visit, onVisit, onLeave }: { visit: GameVisit; onVisit: (patch: Partial<GameVisit>) => void; onLeave: () => void }) {
  const { t } = useTranslation()
  const { settings, gpu, patcher, saveSettings, selectGamePath, repair, checkRuntimes, setCompatibilityFix } = useLauncher()
  const { invalidPath, fixResult, fixWorking } = visit

  if (!settings) return null

  async function browse(): Promise<void> {
    const result = await selectGamePath()
    if (result) onVisit({ invalidPath: !result.valid })
  }

  async function toggleFix(on: boolean): Promise<void> {
    onVisit({ fixWorking: true })
    try {
      onVisit({ fixResult: await setCompatibilityFix(on) })
    } finally {
      onVisit({ fixWorking: false })
    }
  }

  const adapter = amdAdapterName(gpu)
  const rowResult = compatibilityFixRowResult({ visit: fixResult, reconciled: patcher.dxvk, enabled: settings.amdCompatibilityEnabled })

  return (
    <>
      <Row
        title={t('settings.gamePath')}
        hint={t('settings.gamePathHint')}
        note={invalidPath && <p className="text-[13px] text-tos-burgundy">{t('settings.invalidPath')}</p>}
      >
        <input className={`${field} w-44`} value={settings.gamePath} readOnly title={settings.gamePath} aria-label={t('settings.gamePath')} />
        <button type="button" onClick={() => void browse()} className={surfaceButton}>
          {t('settings.browse')}
        </button>
      </Row>

      <Row title={t('settings.launchArgs')} hint={t('settings.launchArgsHint')}>
        <input
          className={`${field} w-44`}
          defaultValue={settings.launchArgs}
          onBlur={(e) => void saveSettings({ launchArgs: e.target.value })}
          spellCheck={false}
          aria-label={t('settings.launchArgs')}
        />
      </Row>

      <Row title={t('settings.afterLaunch')} hint={t('settings.afterLaunchHint')}>
        <select
          className={`${field} w-44`}
          value={settings.afterLaunch}
          onChange={(e) => void saveSettings({ afterLaunch: e.target.value as Settings['afterLaunch'] })}
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
            <p className="mt-1.5 text-[13px] text-tos-brown-light">{adapter ? t('dxvk.adapter', { name: adapter }) : t('settings.amdFixNoAdapter')}</p>
            <p className="mt-0.5 text-[11px] text-tos-brown-muted">{t('settings.amdFixAttribution', { version: DXVK_VERSION })}</p>
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
            onLeave()
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
            onLeave()
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
          className={`${field} w-44`}
          value={settings.language}
          onChange={(e) => void saveSettings({ language: e.target.value as Settings['language'] })}
          aria-label={t('settings.language')}
        >
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en">English</option>
        </select>
      </Row>

      <Row title={t('settings.downloadConcurrency')} hint={t('settings.downloadConcurrencyHint')}>
        <select
          className={`${field} w-44`}
          value={settings.downloadConcurrency}
          onChange={(e) => void saveSettings({ downloadConcurrency: Number(e.target.value) as Settings['downloadConcurrency'] })}
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
        note={restartRequired && <p className="text-[13px] text-tos-burgundy">{t('settings.restartRequired')}</p>}
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
