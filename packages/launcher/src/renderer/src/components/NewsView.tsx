import { useTranslation } from 'react-i18next'
import { NewsList, NewsStaleBadge } from './NewsList'

/** The News view: the whole feed as the same dated list, full bodies, scrolling in the left column. */
export function NewsView() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-0 flex-1 flex-col pb-4 pl-14 pt-8">
      <div className="flex w-[600px] shrink-0 items-baseline gap-4 border-b border-tos-border-dark pb-3">
        <h1 className="font-display text-[34px] font-bold leading-none text-tos-burgundy">{t('news.title')}</h1>
        <NewsStaleBadge />
      </div>
      <NewsList />
    </main>
  )
}
