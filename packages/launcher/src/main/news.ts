import { promises as fs } from 'node:fs'
import { newsFeedSchema, type NewsItem, type NewsResult } from '@yufa/shared'

function sortItems(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.date.localeCompare(a.date)
  })
}

export async function fetchNews(
  newsUrl: string,
  cachePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NewsResult> {
  try {
    const sep = newsUrl.includes('?') ? '&' : '?'
    const res = await fetchImpl(`${newsUrl}${sep}t=${Date.now()}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const feed = newsFeedSchema.parse(await res.json())
    await fs.writeFile(cachePath, JSON.stringify(feed), 'utf8').catch(() => {})
    return { items: sortItems(feed.items), stale: false }
  } catch {
    try {
      const cached = newsFeedSchema.parse(JSON.parse(await fs.readFile(cachePath, 'utf8')))
      return { items: sortItems(cached.items), stale: true }
    } catch {
      return { items: [], stale: true }
    }
  }
}
