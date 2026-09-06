import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '../lib/format'
import { useLauncher } from '../store'

const field =
  'w-full rounded-md border border-tos-input-border bg-tos-input-bg px-3 py-2 text-sm text-tos-brown outline-none focus:border-tos-orange'
const surfaceButton =
  'rounded-md bg-tos-tan px-3 py-2 text-sm text-tos-brown-light hover:bg-tos-border hover:text-tos-brown'

/**
 * First-run card: where the game goes. Shown while the patcher reports
 * not-installed (folder editable; the footer's Install button enables only
 * once the main process judged it ok) and while an interrupted install in
 * the configured folder waits to be resumed (folder fixed, hint shown).
 */
export function InstallPanel() {
  const { patcher, settings, installPath, installCheck, installChecking, setInstallPath, browseInstallPath } =
    useLauncher()
  const { t } = useTranslation()

  if (patcher.state === 'update-available' && patcher.installIncomplete) {
    return (
      <Card title={t('install.resumeTitle')} intro={t('install.resumeIntro')}>
        <label className={labelClass}>{t('install.folder')}</label>
        <input className={field} value={settings?.gamePath ?? ''} readOnly />
      </Card>
    )
  }

  if (patcher.state !== 'not-installed') return null

  const check = installCheck && installCheck.path === installPath ? installCheck : null

  return (
    <Card title={t('install.title')} intro={t('install.intro')}>
      <label className={labelClass}>{t('install.folder')}</label>
      <div className="flex gap-2">
        <input
          className={`${field} flex-1`}
          value={installPath}
          onChange={(e) => setInstallPath(e.target.value)}
          spellCheck={false}
          aria-invalid={check ? !check.ok : undefined}
        />
        <button type="button" onClick={() => void browseInstallPath()} className={`shrink-0 ${surfaceButton}`}>
          {t('install.browse')}
        </button>
      </div>

      <div className="mt-2 min-h-[1.25rem] text-xs">
        {installChecking || !check ? (
          <p className="text-tos-brown-muted">{t('install.checking')}</p>
        ) : (
          <>
            <p className={check.problems.includes('not-enough-space') ? 'text-tos-burgundy' : 'text-tos-brown-light'}>
              {t('install.space', {
                free: check.freeBytes === null ? '—' : formatBytes(check.freeBytes),
                required: check.requiredBytes === null ? '—' : formatBytes(check.requiredBytes),
              })}
            </p>
            {check.problems.map((problem) => (
              <p key={problem} className="text-tos-burgundy">
                {t(`install.problem.${problem}`)}
              </p>
            ))}
            {check.ok && check.existing !== 'none' && (
              <p className="text-tos-green">
                {t(check.existing === 'partial' ? 'install.partialHint' : 'install.completeHint')}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

const labelClass = 'mt-3 mb-1 block text-xs font-medium uppercase tracking-wide text-tos-brown-light'

function Card({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="mx-8 mb-3 rounded-tos-panel border border-tos-border bg-tos-cream/90 px-5 py-4 shadow-tos-panel backdrop-blur-sm">
      <h2 className="font-display text-lg font-bold text-tos-burgundy">{title}</h2>
      <p className="mt-0.5 text-xs text-tos-brown-light">{intro}</p>
      {children}
    </div>
  )
}
