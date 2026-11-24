import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { invalidatePrefixes } from '../../lib/invalidate'
import type { PendingApprovalRow } from '../../types/database'
import * as api from './api'
import { decideApproval } from './execute'

/**
 * 1.5: قسم «اعتمادات معلّقة» أعلى صفحة المالية — يظهر فقط عند وجود
 * طلبات. الاعتماد ينفّذ الفعل الأصلي؛ الرفض يلغيه بلا أثر.
 */
export function ApprovalsSection({
  nurseryId,
  actorId,
}: {
  nurseryId: string
  actorId: string | null
}) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const pending = useQuery({
    queryKey: ['approvals', nurseryId],
    queryFn: () => api.listPendingApprovals(nurseryId),
  })
  const decide = useMutation({
    mutationFn: (args: { row: PendingApprovalRow; approved: boolean }) =>
      decideApproval(nurseryId, actorId, args.row, args.approved),
    onSuccess: (_d, args) => {
      invalidatePrefixes(qc, [
        'approvals',
        'proofs',
        'invoices',
        'invoice',
        'expenses',
        'month-money',
        'cashbox-close',
        'cashbox-breakdown',
        'home',
      ])
      showToast(
        args.approved ? t('finance.approvedDone') : t('finance.rejectedDone'),
      )
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  const rows = pending.data ?? []
  if (rows.length === 0) return null
  return (
    <section>
      <h2 className="type-section mb-2 flex items-center gap-1.5">
        <ShieldCheck size={18} />
        {t('finance.approvalsTitle')} ({rows.length})
      </h2>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <Card key={row.id} className="flex flex-col gap-2">
            <span className="type-body">{row.summary}</span>
            <span className="type-badge text-muted">
              {row.created_at.slice(0, 10)}
              {row.requested_by === actorId ? ` • ${t('finance.selfNote')}` : ''}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ row, approved: true })}
              >
                {t('finance.approve')}
              </Button>
              <Button
                size="sm"
                variant="soft"
                className="flex-1"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ row, approved: false })}
              >
                {t('finance.reject')}
              </Button>
            </span>
          </Card>
        ))}
      </div>
    </section>
  )
}
