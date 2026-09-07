import { describe, expect, it } from 'vitest'
import type { NewsItem } from '@yufa/shared'
import { homeNews, orderNews } from '../src/renderer/src/lib/news'

const item = (id: string, date: string, pinned = false): NewsItem => ({
  id,
  date,
  pinned,
  title: { en: id },
  body: { en: id },
})

describe('orderNews', () => {
  it('puts pinned items first, then the newest', () => {
    const items = [item('old', '2026-06-01'), item('pinned-old', '2026-05-01', true), item('new', '2026-07-01')]
    expect(orderNews(items).map((i) => i.id)).toEqual(['pinned-old', 'new', 'old'])
  })

  it('orders pinned items among themselves by date too', () => {
    const items = [item('p-old', '2026-01-01', true), item('p-new', '2026-03-01', true)]
    expect(orderNews(items).map((i) => i.id)).toEqual(['p-new', 'p-old'])
  })

  it('leaves the feed alone', () => {
    const items = [item('b', '2026-06-01'), item('a', '2026-07-01')]
    orderNews(items)
    expect(items.map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('homeNews', () => {
  it('is the first three cards in that order', () => {
    const items = [item('1', '2026-06-01'), item('2', '2026-06-02'), item('3', '2026-06-03'), item('4', '2026-06-04', true)]
    expect(homeNews(items).map((i) => i.id)).toEqual(['4', '3', '2'])
  })

  it('shows what there is when the feed is short', () => {
    expect(homeNews([item('only', '2026-06-01')]).map((i) => i.id)).toEqual(['only'])
    expect(homeNews([])).toEqual([])
  })
})
