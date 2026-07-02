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
      className={`rounded-lg border p-3 transition-colors ${
        item.pinned ? 'border-amber-400/30 bg-amber-400/5' : 'border-white/5 bg-white/[0.03]'
      } ${clickable ? 'cursor-pointer hover:border-amber-400/50' : ''}`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{pickText(item.title, lang)}</h3>
        {item.pinned && <span className="text-[10px] text-amber-400">★</span>}
      </div>
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">{formatDate(item.date, lang)}</p>
      <p className="line-clamp-3 text-xs leading-relaxed text-slate-400">{pickText(item.body, lang)}</p>
    </article>
  )
}

export function NewsPanel() {
  const news = useLauncher((s) => s.news)
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-white/5 bg-black/30">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">{t('news.title')}</h2>
        {news?.stale && (
          <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-300">
            {t('news.stale')}
          </span>
        )}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {news?.items.map((item) => <NewsCard key={item.id} item={item} lang={lang} />)}
        {news && news.items.length === 0 && <p className="px-1 text-xs text-slate-500">{t('news.empty')}</p>}
      </div>
    </aside>
  )
}
