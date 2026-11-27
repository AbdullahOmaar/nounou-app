import { useQuery } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { formatDateTimeAr } from '../../lib/format'
import { fetchPlatformOverview } from './api'

export default function OpsPage() {
  const t = useT()
  const q = useQuery({
    queryKey: ['platform-overview'],
    queryFn: fetchPlatformOverview,
  })
  if (q.isPending) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void q.refetch()}
      />
    )
  const rows = q.data ?? []
  return (
    <div className="space-y-3">
      <p className="type-body text-muted">{t('ops.body')}</p>
      {rows.length === 0 ? (
        <EmptyState icon={Building2} title={t('ops.empty')} />
      ) : (
        rows.map((r) => (
          <Card key={r.nursery_id} className="space-y-1">
            <span className="type-card-title">{r.name}</span>
            <span className="type-body text-muted block">
              {t('ops.children')}: {r.children} • {t('ops.members')}:{' '}
              {r.members} • {t('ops.invoicesMonth')}: {r.invoices_month}
            </span>
            <span className="type-badge text-muted block">
              {t('ops.lastActivity')}:{' '}
              {r.last_activity
                ? formatDateTimeAr(r.last_activity)
                : t('ops.never')}
            </span>
          </Card>
        ))
      )}
    </div>
  )
}
