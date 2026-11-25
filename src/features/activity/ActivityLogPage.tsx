import { useQuery } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { formatDateTimeAr } from '../../lib/format'
import { requireSupabase } from '../../lib/supabase'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import type { ActivityLogRow } from '../../types/database'

/** سجل النشاط: أحدث عمليات الحضانة بترتيب زمني عكسي */
export function ActivityLogPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const activity = useQuery({
    queryKey: ['activity', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: async (): Promise<ActivityLogRow[]> => {
      const db = requireSupabase()
      const { data, error } = await db
        .from('activity_log')
        .select('*')
        .eq('nursery_id', nurseryId!)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as ActivityLogRow[]
    },
  })

  if (activity.isPending) return <LoadingState />
  if (activity.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void activity.refetch()}
      />
    )
  const list = activity.data ?? []
  if (list.length === 0) return <EmptyState title={t('activity.empty')} />

  const kindLabel = (kind: string): string => {
    switch (kind) {
      case 'child_created':
        return t('activity.kind.child_created')
      case 'child_updated':
        return t('activity.kind.child_updated')
      case 'invoice_issued':
        return t('activity.kind.invoice_issued')
      case 'payment_recorded':
        return t('activity.kind.payment_recorded')
      case 'payment_reversed':
        return t('activity.kind.payment_reversed')
      case 'proof_approved':
        return t('activity.kind.proof_approved')
      case 'proof_rejected':
        return t('activity.kind.proof_rejected')
      case 'report_published':
        return t('activity.kind.report_published')
      case 'announcement_published':
        return t('activity.kind.announcement_published')
      case 'member_invited':
        return t('activity.kind.member_invited')
      case 'member_removed':
        return t('activity.kind.member_removed')
      case 'child_archived':
        return t('activity.kind.child_archived')
      case 'settings_updated':
        return t('activity.kind.settings_updated')
      case 'pickup_code_failed':
        return t('activity.kind.pickup_code_failed')
      case 'bus_trip_closed':
        return t('activity.kind.bus_trip_closed')
      case 'data_request_handled':
      return t('activity.dataRequestHandled')
    case 'salary_paid':
      return t('activity.salaryPaid')
    case 'expense_recorded':
        return t('activity.kind.expense_recorded')
      case 'expense_deleted':
        return t('activity.kind.expense_deleted')
      case 'cashbox_entry_added':
        return t('activity.kind.cashbox_entry_added')
      case 'cashbox_entry_deleted':
        return t('activity.kind.cashbox_entry_deleted')
      case 'cashbox_closed':
        return t('activity.kind.cashbox_closed')
      case 'supplier_added':
        return t('activity.kind.supplier_added')
      case 'order_added':
        return t('activity.kind.order_added')
      case 'supplier_paid':
        return t('activity.kind.supplier_paid')
      case 'approval_requested':
        return t('activity.kind.approval_requested')
      case 'approval_approved':
        return t('activity.kind.approval_approved')
      case 'approval_rejected':
        return t('activity.kind.approval_rejected')
      case 'fee_reminders_run':
        return t('activity.kind.fee_reminders_run')
      case 'qa_session_created':
        return t('activity.kind.qa_session_created')
      case 'tour_converted':
        return t('activity.kind.tour_converted')
      case 'event_created':
        return t('activity.kind.event_created')
      case 'message_sent':
        return t('activity.kind.message_sent')
      case 'link_issued':
        return t('activity.kind.link_issued')
      case 'link_revoked':
        return t('activity.kind.link_revoked')
      default:
        return kind
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {list.map((item) => (
        <Card key={item.id} className="py-3">
          <div className="type-body">
            {kindLabel(item.kind)}
            {item.summary ? ` — ${item.summary}` : ''}
          </div>
          <div className="type-badge text-muted">
            {formatDateTimeAr(item.created_at)}
          </div>
        </Card>
      ))}
    </div>
  )
}
