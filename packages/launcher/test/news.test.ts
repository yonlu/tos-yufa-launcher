import { describe, expect, it } from 'vitest'
import type { NewsPost } from '@yufa/shared'
import { homeNews, orderNews } from '../src/renderer/src/lib/news'

const post = (slug: string, publishedAt: number, pinned = false, id = publishedAt): NewsPost => ({
  id,
  slug,
  title: slug,
  category: 'update',
  excerpt: slug,
  coverImage: null,
  pinned,
  publishedAt,
  url: `https://tosclassic.com/news/${slug}`,
})

describe('orderNews', () => {
  it('puts pinned posts first, then the newest', () => {
    const posts = [post('old', 2), post('pinned-old', 1, true), post('new', 3)]
    expect(orderNews(posts).map((p) => p.slug)).toEqual(['pinned-old', 'new', 'old'])
  })

  it('orders pinned posts among themselves by date too', () => {
    const posts = [post('p-old', 1, true), post('p-new', 2, true)]
    expect(orderNews(posts).map((p) => p.slug)).toEqual(['p-new', 'p-old'])
  })

  it('breaks a tie on the moment by the higher id, as the site does', () => {
    const posts = [post('first', 5, false, 1), post('second', 5, false, 2)]
    expect(orderNews(posts).map((p) => p.slug)).toEqual(['second', 'first'])
  })

  it('leaves the feed alone', () => {
    const posts = [post('b', 1), post('a', 2)]
    orderNews(posts)
    expect(posts.map((p) => p.slug)).toEqual(['b', 'a'])
  })
})

describe('homeNews', () => {
  it('is the first three rows in that order', () => {
    const posts = [post('1', 1), post('2', 2), post('3', 3), post('4', 4, true)]
    expect(homeNews(posts).map((p) => p.slug)).toEqual(['4', '3', '2'])
  })

  it('shows what there is when the feed is short', () => {
    expect(homeNews([post('only', 1)]).map((p) => p.slug)).toEqual(['only'])
    expect(homeNews([])).toEqual([])
  })
})
