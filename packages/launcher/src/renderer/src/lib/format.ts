export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function formatEta(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`
  return `${seconds}s`
}

/**
 * A news date the way the site's patch-note list writes it: `01 jul 2026`,
 * the month abbreviated in the launcher's language and stripped of the
 * period some locales add (pt-BR gives `jul.`). The list sets it in
 * uppercase mono. The feed gives the moment as epoch ms; the day is taken
 * in UTC, as the site prints it, so both show the same date. A number that
 * is not a moment shows nothing.
 */
export function formatNewsDate(publishedAt: number, lang: string): string {
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return ''
  const day = String(date.getUTCDate()).padStart(2, '0')
  const year = date.getUTCFullYear()
  const month = (locale: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date).replace(/\./g, '').toLowerCase()
  let name: string
  try {
    name = month(lang)
  } catch {
    name = month('en')
  }
  return `${day} ${name} ${year}`
}
