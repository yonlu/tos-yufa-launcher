import { useTranslation } from 'react-i18next'
import type { NewsPost } from '@yufa/shared'
import { formatNewsDate } from '../lib/format'
import { homeNews, orderNews } from '../lib/news'
import { focusRing, monoLabel, textLink } from '../lib/ui'
import { useLauncher } from '../store'

/**
 * One post of the site's feed as a row of its patch-note list: the date in
 * mono in its own column with the category under it, the title in
 * Philosopher (a link to the article on the site), the pin mark, the
 * excerpt under it. Home clamps the excerpt to two lines; the News view
 * shows all of it. A category the launcher has no name for yet (the feed
 * may grow one) shows its id.
 */
function NewsRow({ post, lang, clamp }: { post: NewsPost; lang: string; clamp: boolean }) {
  const { t } = useTranslation()
  return (
    <li className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 border-b border-tos-border py-3 last:border-0">
      <div className={`flex flex-col gap-1 pt-[3px] ${monoLabel}`}>
        <time dateTime={new Date(post.publishedAt).toISOString()}>{formatNewsDate(post.publishedAt, lang)}</time>
        <span className="text-tos-brown-muted">{t(`news.category.${post.category}`, post.category)}</span>
      </div>
      <article className="flex min-w-0 flex-col gap-0.5">
        <h3 className="font-display text-base font-bold leading-[1.3] text-tos-brown">
          <button
            type="button"
            onClick={() => void window.yufa.appOpenExternal(post.url)}
            className={`text-left transition-colors hover:text-tos-burgundy ${focusRing}`}
          >
            {post.title}
          </button>
          {post.pinned && (
            <span className="ml-2 rounded bg-tos-tab-bg px-1.5 py-px align-[2px] font-body text-[10px] font-medium uppercase tracking-[0.05em] text-tos-orange-dark">
              {t('news.pinned')}
            </span>
          )}
        </h3>
        <p className={`text-[13px] leading-[1.45] text-tos-brown-light ${clamp ? 'line-clamp-2' : ''}`}>{post.excerpt}</p>
      </article>
    </li>
  )
}

/** The feed came from the cache because the server did not answer: a small mono chip next to whatever heads the news. */
export function NewsStaleBadge() {
  const stale = useLauncher((s) => s.news?.stale ?? false)
  const { t } = useTranslation()
  if (!stale) return null
  return <span className={`rounded bg-tos-tan px-1.5 py-0.5 ${monoLabel}`}>{t('news.stale')}</span>
}

/**
 * The news on Home: a heading row with View all, then the first three
 * posts, pinned first then newest. The list takes the height left under
 * the headline and fades out at its foot, so a long day of warnings above
 * it never cuts a row in half.
 */
export function HomeNews({ onViewAll }: { onViewAll: () => void }) {
  const news = useLauncher((s) => s.news)
  const { t, i18n } = useTranslation()
  if (!news) return null
  const posts = homeNews(news.posts)
  return (
    <section aria-labelledby="home-news" className="mt-9 flex min-h-0 w-[450px] flex-1 flex-col">
      <div className="flex shrink-0 items-baseline justify-between border-b border-tos-border-dark pb-2">
        <h2 id="home-news" className="font-display text-[17px] font-bold text-tos-burgundy">
          {t('news.title')}
        </h2>
        <span className="flex items-baseline gap-3">
          <NewsStaleBadge />
          <button type="button" onClick={onViewAll} className={`text-[13px] ${textLink}`}>
            {t('news.viewAll')}
          </button>
        </span>
      </div>
      {posts.length === 0 ? (
        <p className="py-3 text-[13px] text-tos-brown-muted">{t('news.empty')}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-hidden mask-b-from-[calc(100%-28px)]">
          {posts.map((post) => (
            <NewsRow key={post.id} post={post} lang={i18n.language} clamp />
          ))}
        </ul>
      )}
    </section>
  )
}

/** The News view's list: the whole page, full excerpts, scrolling. */
export function NewsList() {
  const news = useLauncher((s) => s.news)
  const { t, i18n } = useTranslation()
  if (!news) return null
  const posts = orderNews(news.posts)
  if (posts.length === 0) return <p className="py-3 text-[13px] text-tos-brown-muted">{t('news.empty')}</p>
  return (
    <ul className="min-h-0 w-[600px] flex-1 overflow-y-auto pr-3">
      {posts.map((post) => (
        <NewsRow key={post.id} post={post} lang={i18n.language} clamp={false} />
      ))}
    </ul>
  )
}
