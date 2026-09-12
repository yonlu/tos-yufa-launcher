import { describe, expect, it } from 'vitest'
import { newsFeedSchema } from '../src/index'

const post = {
  id: 7,
  slug: 'double-exp',
  title: 'Double EXP',
  category: 'event',
  excerpt: 'Until Jul 7.',
  coverImage: null,
  pinned: false,
  publishedAt: 1782950400000,
  url: 'https://tosclassic.com/news/double-exp',
}

describe('newsFeedSchema (site contract v1)', () => {
  it('keeps the posts and drops the paging fields and anything new', () => {
    const parsed = newsFeedSchema.parse({
      posts: [{ ...post, author: 'someone new' }],
      page: 1,
      pageCount: 3,
      totalCount: 30,
    })
    expect(parsed).toEqual({ posts: [post] })
  })

  it('accepts an empty page', () => {
    expect(newsFeedSchema.parse({ posts: [] })).toEqual({ posts: [] })
  })

  it('rejects the bucket feed of old, and a post without its link', () => {
    expect(newsFeedSchema.safeParse({ schemaVersion: 1, items: [] }).success).toBe(false)
    expect(newsFeedSchema.safeParse({ posts: [{ ...post, url: '/news/double-exp' }] }).success).toBe(false)
    expect(newsFeedSchema.safeParse({ posts: [{ ...post, publishedAt: '2026-07-01' }] }).success).toBe(false)
  })
})
