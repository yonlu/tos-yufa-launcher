import type { NewsItem } from '@yufa/shared'

/** How many cards the home row holds beside the community card; App's grid has that many card columns. */
const HOME_CARD_COUNT = 3

/** The feed as the shell shows it: pinned items first, then the newest. The feed itself is not touched. */
export function orderNews(items: readonly NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.date.localeCompare(a.date)
  })
}

/** The home row: the first cards of the ordered feed. */
export function homeNews(items: readonly NewsItem[]): NewsItem[] {
  return orderNews(items).slice(0, HOME_CARD_COUNT)
}
