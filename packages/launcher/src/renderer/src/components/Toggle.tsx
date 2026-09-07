/**
 * A switch for the on/off settings: the control on the right of a Settings
 * row, in place of a checkbox. Announced as a switch; the row's title is
 * its label.
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
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tos-orange disabled:cursor-default disabled:opacity-50 ${
        on ? 'bg-gradient-to-b from-tos-orange-light to-tos-orange-dark' : 'bg-tos-border-dark hover:bg-tos-brown-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}
