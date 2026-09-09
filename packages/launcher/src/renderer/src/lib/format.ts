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
 * uppercase mono. Anything that is not a `YYYY-MM-DD` date is shown as is.
 */
export function formatNewsDate(iso: string, lang: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const [, year, month, day] = match
  try {
    const name = new Intl.DateTimeFormat(lang, { month: 'short' })
      .format(new Date(Number(year), Number(month) - 1, 1))
      .replace(/\./g, '')
      .toLowerCase()
    return `${day} ${name} ${year}`
  } catch {
    return iso
  }
}
