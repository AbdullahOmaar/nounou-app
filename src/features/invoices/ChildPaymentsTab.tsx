import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { formatDateTimeAr, formatMoney } from '../../lib/format'
import { useChildPayments } from './hooks'
import { RecordPaymentSheet } from './RecordPaymentSheet'

/** تبويب مدفوعات الطفل في ملفه (المالك فقط — يُركّب شرطياً من ملف الطفل) */
export function ChildPaymentsTab({ childId }: { childId: string }) {
  const t = useT()
  const payments = useChildPayments(childId, true)
  const [payOpen, setPayOpen] = useState(false)

  if (payments.isPending) return <LoadingState />
  if (payments.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void payments.refetch()}
      />
    )
  const list = payments.data ?? []
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button variant="soft" size="sm" onClick={() => setPayOpen(true)}>
          <Plus size={16} />
          {t('invoices.recordPayment')}
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="type-secondary text-muted">{t('invoices.noPayments')}</p>
      ) : (
        list.map((p) => (
          <Card key={p.id} className="py-3">
            <div className="flex items-center justify-between">
              <span className="type-body">{formatMoney(p.amount)}</span>
              <span className="type-badge text-muted">
                {p.method === 'cash'
                  ? t('invoices.methodCash')
                  : p.method === 'vodafone_cash'
                    ? t('invoices.methodVodafone')
                    : p.method === 'instapay'
                      ? t('invoices.methodInstapay')
                      : t('invoices.methodBank')}
                {p.receipt_no ? ` • ${t('invoices.receiptNo', { no: p.receipt_no })}` : ''}
              </span>
            </div>
            <div className="type-badge text-muted">
              {formatDateTimeAr(p.paid_at)}
              {p.proof_status === 'pending' && ` • ${t('common.pendingReview')}`}
              {p.reversed_by_id && ` • ${t('invoices.reversedBadge')}`}
            </div>
          </Card>
        ))
      )}
      <RecordPaymentSheet
        open={payOpen}
        onClose={() => setPayOpen(false)}
        childId={childId}
        invoiceId={null}
      />
    </div>
  )
}
