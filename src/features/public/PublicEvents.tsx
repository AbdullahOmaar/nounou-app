import { Link, useOutletContext, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PartyPopper } from 'lucide-react'
import * as api from '../events/api'
import type { PublicPageData } from './api'
import { useT } from '../../i18n'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { formatDateTimeAr } from '../../lib/format'

/** تقويم مناسبات الحضانة على موقعها العام (3.9). */
export default function PublicEvents() {
  const t = useT()
  const data = useOutletContext<PublicPageData>()
  const { slug } = useParams<{ slug: string }>()
  const events = useQuery({
    queryKey: ['public-events', slug],
    queryFn: () => api.fetchPublicNurseryEvents(slug!),
    enabled: !!slug,
  })
  void data

  if (events.isPending) return <LoadingState />
  if (events.isError) {
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void events.refetch()}
      />
    )
  }
  const rows = events.data ?? []
  const now = Date.now()
  const upcoming = rows.filter((e) => new Date(e.starts_at).getTime() >= now)
  const past = rows.filter((e) => new Date(e.starts_at).getTime() < now)

  const renderRow = (e: (typeof rows)[number]) => (
    <Link
      key={e.public_code}
      to={`/e/${e.public_code}`}
      className="block rounded-3xl bg-card p-4 shadow-sm"
    >
      <div className="type-body">{e.title}</div>
      <div className="type-secondary text-muted">
        {formatDateTimeAr(e.starts_at)}
        {e.location_text ? ` — ${e.location_text}` : ''}
      </div>
    </Link>
  )

  return (
    <div className="flex flex-col gap-4">
      <h2 className="type-body">{t('pub.eventsTitle')}</h2>
      {rows.length === 0 ? (
        <EmptyState icon={PartyPopper} title={t('pub.eventsEmpty')} />
      ) : (
        <>
          {upcoming.map(renderRow)}
          {past.length > 0 && (
            <>
              <h3 className="type-secondary text-muted">{t('pub.eventsPast')}</h3>
              {past.map(renderRow)}
            </>
          )}
        </>
      )}
    </div>
  )
}
