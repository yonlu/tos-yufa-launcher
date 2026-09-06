import { useTranslation } from 'react-i18next'
import type { NewsItem } from '@yufa/shared'
import { pickText } from '../i18n'
import { formatDate } from '../lib/format'
import { useLauncher } from '../store'

function NewsCard({ item, lang }: { item: NewsItem; lang: string }) {
  const clickable = Boolean(item.url)
  return (
    <article
      onClick={() => item.url && window.yufa.appOpenExternal(item.url)}
      className={`rounded-tos-panel border p-3 shadow-tos-panel transition-all duration-300 ${
        item.pinned ? 'border-tos-orange/40 bg-tos-tab-bg/40' : 'border-tos-border bg-tos-cream'
      } ${clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:border-tos-orange/60 hover:shadow-lg' : ''}`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold text-tos-brown">{pickText(item.title, lang)}</h3>
        {item.pinned && <span className="text-[10px] text-tos-orange-dark">★</span>}
      </div>
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-tos-brown-muted">{formatDate(item.date, lang)}</p>
      <p className="line-clamp-3 text-xs leading-relaxed text-tos-brown-light">{pickText(item.body, lang)}</p>
    </article>
  )
}

export function NewsPanel() {
  const news = useLauncher((s) => s.news)
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-tos-border bg-tos-tan">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <h2 className="font-display text-xs font-bold uppercase tracking-[0.2em] text-tos-brown-light">
          {t('news.title')}
        </h2>
        {news?.stale && (
          <span className="rounded bg-tos-orange/15 px-1.5 py-0.5 text-[10px] text-tos-orange-dark">
            {t('news.stale')}
          </span>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {news?.items.map((item) => <NewsCard key={item.id} item={item} lang={lang} />)}
        {news && news.items.length === 0 && <p className="px-1 text-xs text-tos-brown-muted">{t('news.empty')}</p>}
      </div>
    </aside>
  )
}
