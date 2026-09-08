import { useTranslation } from 'react-i18next'
import type { DxvkResult } from '@yufa/shared'
import { dxvkReason, dxvkRefusalKey } from '../lib/compatibilityFix'

/**
 * Why an enable or disable the player asked for was refused, with the raw
 * detail (a path) under it. Shown in place: under the switch in Settings,
 * inside the one-time prompt. Renders nothing for an outcome that needs no
 * explanation.
 */
export function CompatibilityFixRefusal({ result }: { result: DxvkResult | null }) {
  const { t } = useTranslation()
  const reason = dxvkReason(result ?? undefined)
  if (!reason) return null
  return (
    <>
      <p className="text-[13px] leading-[1.45] text-tos-burgundy">{t(dxvkRefusalKey(reason))}</p>
      {result?.error?.message && <p className="mt-0.5 break-all font-mono text-[11px] text-tos-brown-muted">{result.error.message}</p>}
    </>
  )
}
