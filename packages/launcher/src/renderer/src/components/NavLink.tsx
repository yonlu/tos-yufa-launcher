import type { ReactNode } from 'react'
import { focusRing } from '../lib/ui'

/** A text link in the site's navbar style: Philosopher, brown, orange with an underline when it is the current view. */
export function NavLink({
  active = false,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`font-display border-b-2 px-0.5 py-1.5 text-[15px] font-bold leading-5 transition-colors hover:text-tos-orange-dark ${focusRing} ${
        active ? 'border-tos-orange text-tos-orange-dark' : 'border-transparent text-tos-brown'
      }`}
    >
      {children}
    </button>
  )
}
