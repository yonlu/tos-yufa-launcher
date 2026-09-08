import { useTranslation } from 'react-i18next'
import { formatBytes } from '../lib/format'
import { installPanelUp } from '../lib/shell'
import { field, monoLabel, surfaceButton } from '../lib/ui'
import { useLauncher } from '../store'

/**
 * First run: where the game goes, in the subtitle's place. While the
 * patcher reports not-installed the folder is editable (Play's Install
 * enables only once the main process judged it ok) and the line under it
 * says what the drive has and what the Build needs, or what is wrong with
 * the folder. While an interrupted install in the configured folder waits
 * to be resumed, the folder is shown fixed.
 */
export function InstallPanel() {
  const { patcher, settings, installPath, installCheck, installChecking, setInstallPath, browseInstallPath } =
    useLauncher()
  const { t } = useTranslation()

  if (!installPanelUp(patcher)) return null
  if (patcher.state !== 'not-installed') {
    return (
      <div>
        <p className="text-base leading-[1.55] text-tos-brown-light">{t('install.resumeIntro')}</p>
        <p className={`mt-3 ${monoLabel}`}>{t('install.folder')}</p>
        <p className="truncate text-sm text-tos-brown" title={settings?.gamePath}>
          {settings?.gamePath}
        </p>
      </div>
    )
  }

  const check = installCheck && installCheck.path === installPath ? installCheck : null

  return (
    <div>
      <p className="text-base leading-[1.55] text-tos-brown-light">{t('install.intro')}</p>
      <div className="mt-3 flex gap-2">
        <input
          className={`${field} min-w-0 flex-1`}
          value={installPath}
          onChange={(e) => setInstallPath(e.target.value)}
          spellCheck={false}
          aria-label={t('install.folder')}
          aria-invalid={check ? !check.ok : undefined}
        />
        <button type="button" onClick={() => void browseInstallPath()} className={`shrink-0 ${surfaceButton}`}>
          {t('install.browse')}
        </button>
      </div>

      <div className="mt-2 min-h-4 text-[13px] leading-[1.45]" aria-live="polite">
        {installChecking || !check ? (
          <p className="text-tos-brown-muted">{t('install.checking')}</p>
        ) : (
          <>
            <p className={check.problems.includes('not-enough-space') ? 'text-tos-burgundy' : 'text-tos-brown-light'}>
              {t('install.space', {
                free: check.freeBytes === null ? '?' : formatBytes(check.freeBytes),
                required: check.requiredBytes === null ? '?' : formatBytes(check.requiredBytes),
              })}
            </p>
            {check.problems.map((problem) => (
              <p key={problem} className="text-tos-burgundy">
                {t(`install.problem.${problem}`)}
              </p>
            ))}
            {check.ok && check.existing !== 'none' && (
              <p className="text-tos-brown">{t(check.existing === 'partial' ? 'install.partialHint' : 'install.completeHint')}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
