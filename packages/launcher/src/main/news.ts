import { promises as fs } from 'node:fs'
import { NEWS_FEED_LIMIT, newsFeedSchema, type NewsResult } from '@yufa/shared'

/**
 * One page of the site's news feed (contract v1: `{ posts, page, pageCount,
 * totalCount }`, posts without bodies), the largest page the site hands out.
 * The page that arrives is saved next to the settings, and served from there,
 * marked stale, whenever the site does not answer or answers something the
 * contract does not describe; with no saved page either, the list is empty.
 * No cache-buster: the site caches the feed at its edge for a few minutes on
 * purpose and refreshes it the moment a post is published.
 */
export async function fetchNews(apiUrl: string, cachePath: string, fetchImpl: typeof fetch = fetch): Promise<NewsResult> {
  try {
    const url = new URL(apiUrl)
    url.searchParams.set('limit', String(NEWS_FEED_LIMIT))
    const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const feed = newsFeedSchema.parse(await res.json())
    await fs.writeFile(cachePath, JSON.stringify(feed), 'utf8').catch(() => {})
    return { posts: feed.posts, stale: false }
  } catch {
    try {
      const cached = newsFeedSchema.parse(JSON.parse(await fs.readFile(cachePath, 'utf8')))
      return { posts: cached.posts, stale: true }
    } catch {
      return { posts: [], stale: true }
    }
  }
}
