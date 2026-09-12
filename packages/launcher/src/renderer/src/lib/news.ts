import type { NewsPost } from '@yufa/shared'

/** How many rows the home list holds under the headline. */
const HOME_ROW_COUNT = 3

/**
 * The feed as the shell shows it: pinned posts first, then the newest, the
 * higher id first when two share a moment (the site orders its list the same
 * way). The feed itself is not touched.
 */
export function orderNews(posts: readonly NewsPost[]): NewsPost[] {
  return [...posts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.publishedAt !== b.publishedAt) return b.publishedAt - a.publishedAt
    return b.id - a.id
  })
}

/** The home list: the first rows of the ordered feed. */
export function homeNews(posts: readonly NewsPost[]): NewsPost[] {
  return orderNews(posts).slice(0, HOME_ROW_COUNT)
}
