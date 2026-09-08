/** The few class strings the views share, so a field or a plain button looks the same on every screen. */

/** The visible focus ring: the site's orange, outside the element, keyboard only. */
export const focusRing = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tos-orange'

/** A text field on the parchment: cream, hairline border, orange when focused. */
export const field = `h-10 rounded-md border border-tos-input-border bg-tos-cream px-3 text-sm text-tos-brown outline-none focus:border-tos-orange ${focusRing}`

/** A secondary button (Browse, Repair, Open): a light tan chip, never orange. */
export const surfaceButton = `h-10 rounded-md border border-tos-border bg-tos-tan px-3 text-sm text-tos-brown-light transition-colors hover:border-tos-border-dark hover:text-tos-brown disabled:cursor-default disabled:opacity-60 ${focusRing}`

/** An inline text link in the site's burgundy. */
export const textLink = `text-tos-burgundy transition-colors hover:text-tos-red-hover ${focusRing}`

/** A data label: mono, small, uppercase, tracked, muted. Dates, revisions, speeds. */
export const monoLabel = 'font-mono text-[11px] uppercase tracking-[0.1em] text-tos-brown-muted'
