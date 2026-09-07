import type { ReactNode } from 'react'

interface WarningPanelProps {
  /** What went wrong, in one sentence. */
  title: ReactNode
  /** Why, or what to do about it. */
  reason: ReactNode
  /** Raw detail from the main process (a path, an exit code); shown small when present. */
  detail?: string
}

/** A non-blocking warning next to Play, which stays enabled: the Redistributable and Compatibility fix outcomes share it. */
export function WarningPanel({ title, reason, detail }: WarningPanelProps) {
  return (
    <div className="max-w-3xl rounded-tos-panel border border-tos-orange-dark/50 bg-tos-cream/95 px-4 py-3 shadow-lg backdrop-blur-sm">
      <p className="text-sm text-tos-brown">{title}</p>
      <p className="mt-0.5 text-xs text-tos-brown-light">{reason}</p>
      {detail && <p className="mt-0.5 break-all text-[10px] text-tos-brown-muted">{detail}</p>}
    </div>
  )
}
