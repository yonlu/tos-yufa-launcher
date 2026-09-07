import { useTranslation } from 'react-i18next'
import type { NewsItem } from '@yufa/shared'
import { pickText } from '../i18n'
import { formatDate } from '../lib/format'
import { homeNews, orderNews } from '../lib/news'
import { useLauncher } from '../store'

function NewsCard({ item, lang, long }: { item: NewsItem; lang: string; long: boolean }) {
  const { t } = useTranslation()
  const clickable = Boolean(item.url)
  return (
    <article
      onClick={() => item.url && void window.yufa.appOpenExternal(item.url)}
      className={`group flex min-h-0 flex-col rounded-tos-panel border bg-tos-cream p-4 shadow-tos-panel transition-all duration-300 ${
        item.pinned ? 'border-tos-orange/50' : 'border-tos-border'
      } ${clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:border-tos-orange/60 hover:shadow-lg' : ''}`}
    >
      <p className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-tos-brown-muted">
        <time dateTime={item.date}>{formatDate(item.date, lang)}</time>
        {item.pinned && (
          <span className="rounded bg-tos-tab-bg px-1.5 py-0.5 font-medium text-tos-orange-dark">{t('news.pinned')}</span>
        )}
      </p>
      <h3 className="font-display text-base font-bold leading-snug text-tos-brown group-hover:text-tos-burgundy">
        {pickText(item.title, lang)}
      </h3>
      <p className={`mt-1.5 text-xs leading-relaxed text-tos-brown-light ${long ? 'line-clamp-6' : 'line-clamp-3'}`}>
        {pickText(item.body, lang)}
      </p>
      {clickable && (
        <p className="mt-auto pt-2 text-[11px] font-medium text-tos-orange-dark opacity-70 transition-opacity group-hover:opacity-100">
          {t('news.readMore')} →
        </p>
      )}
    </article>
  )
}

/** The feed came from the cache because the server did not answer: a small chip next to whatever heads the news. */
export function NewsStaleBadge() {
  const stale = useLauncher((s) => s.news?.stale ?? false)
  const { t } = useTranslation()
  if (!stale) return null
  return <span className="rounded bg-tos-orange/15 px-1.5 py-0.5 text-[10px] text-tos-orange-dark">{t('news.stale')}</span>
}

/**
 * The home row's news: the first three cards, pinned first then newest,
 * into the row's three card columns (App's grid); an empty feed says so
 * across those columns.
 */
export function HomeNews() {
  const news = useLauncher((s) => s.news)
  const { t, i18n } = useTranslation()
  if (!news) return null
  const items = homeNews(news.items)
  if (items.length === 0) return <p className="col-span-3 self-center text-sm text-tos-brown-muted">{t('news.empty')}</p>
  return (
    <>
      {items.map((item) => (
        <NewsCard key={item.id} item={item} lang={i18n.language} long={false} />
      ))}
    </>
  )
}

/** The News view's list: every item, three to a row, with longer bodies. */
export function NewsList() {
  const news = useLauncher((s) => s.news)
  const { t, i18n } = useTranslation()
  if (!news) return null
  const items = orderNews(news.items)
  if (items.length === 0) return <p className="text-sm text-tos-brown-muted">{t('news.empty')}</p>
  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((item) => (
        <NewsCard key={item.id} item={item} lang={i18n.language} long />
      ))}
    </div>
  )
}
