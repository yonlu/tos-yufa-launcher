import type { ReactNode } from 'react'

interface NoticeProps {
  /** An error blocks or changes what Play does; a warning leaves Play alone. */
  tone: 'error' | 'warning'
  /** What went wrong, in one sentence. */
  title: ReactNode
  /** Why, or what to do about it. */
  reason?: ReactNode
  /** Raw detail from the main process (a path, an exit code); shown small when present. */
  detail?: string
}

/**
 * A notice in the subtitle's place: a rule down the left, the sentence,
 * the reason under it. No card, no veil. Errors rule and title in the
 * site's burgundy; warnings (the Redistributable and Compatibility fix
 * outcomes) in the brown ramp.
 */
export function Notice({ tone, title, reason, detail }: NoticeProps) {
  const error = tone === 'error'
  return (
    <div role={error ? 'alert' : 'status'} className={`border-l-2 pl-3 ${error ? 'border-tos-burgundy' : 'border-tos-brown-muted'}`}>
      <p className={`text-sm ${error ? 'text-tos-burgundy' : 'text-tos-brown'}`}>{title}</p>
      {reason && <p className="mt-0.5 text-[13px] leading-[1.45] text-tos-brown-light">{reason}</p>}
      {detail && <p className="mt-1 break-all font-mono text-[11px] text-tos-brown-muted">{detail}</p>}
    </div>
  )
}
