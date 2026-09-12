import { z } from 'zod'

/**
 * The site's news feed, contract v1 (tosclassic.com, its ADR 0007): the
 * list endpoint answers `{ posts, page, pageCount, totalCount }`, each post
 * without its body. Dates are epoch ms, URLs absolute. The contract only
 * ever grows, so the launcher keeps the fields it uses and drops the rest
 * (zod strips unknown keys); a field it does not use is not validated
 * beyond its type, so a stricter site never empties the launcher's feed.
 */
export const newsPostSchema = z.object({
  id: z.number().int(),
  slug: z.string().min(1),
  title: z.string().min(1),
  /** One of the site's category ids (announcement, event, update, maintenance, guide); new ones may appear. */
  category: z.string().min(1),
  excerpt: z.string(),
  coverImage: z.string().nullable(),
  pinned: z.boolean(),
  publishedAt: z.number().int().nonnegative(),
  /** The article on the site, for the browser. */
  url: z.string().url(),
})

export const newsFeedSchema = z.object({
  posts: z.array(newsPostSchema),
})

export type NewsPost = z.infer<typeof newsPostSchema>
export type NewsFeed = z.infer<typeof newsFeedSchema>

/** The most posts the list endpoint hands out per page; the launcher asks for one page of that size. */
export const NEWS_FEED_LIMIT = 50
