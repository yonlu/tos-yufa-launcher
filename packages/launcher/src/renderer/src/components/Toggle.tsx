import { focusRing } from '../lib/ui'

/**
 * A switch for the on/off settings: the control on the right of a Settings
 * row, in place of a checkbox. Announced as a switch; the row's title is
 * its label. On is the site's active-tab orange.
 */
export function Toggle({
  on,
  onChange,
  disabled = false,
  label,
}: {
  on: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-default disabled:opacity-50 ${focusRing} ${
        on ? 'bg-gradient-to-b from-tos-tab-active-start to-tos-tab-active-end' : 'bg-tos-border-dark hover:bg-tos-brown-muted'
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-tos-cream shadow transition-transform ${on ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}
