import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmSheet } from '../../components/ui/ConfirmSheet'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Field, Select, TextInput } from '../../components/ui/form'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { useToast } from '../../components/ui/toast'
import { fmtPeriod } from '../../i18n/format'
import { formatDateTimeAr, formatMoney } from '../../lib/format'
import type { InvoiceLineType, PaymentRow } from '../../types/database'
import { useInvoice, useInvoiceMutations } from './hooks'
import { RecordPaymentSheet } from './RecordPaymentSheet'

const LINE_TYPES: InvoiceLineType[] = ['base', 'discount', 'adjustment', 'bus', 'extra']

export function InvoiceDetailPage() {
  const t = useT()
  const showToast = useToast()
  const { invoiceId } = useParams()
  const bundle = useInvoice(invoiceId)
  const mutations = useInvoiceMutations()
  const [payOpen, setPayOpen] = useState(false)
  const [lineOpen, setLineOpen] = useState(false)
  const [lineType, setLineType] = useState<InvoiceLineType>('extra')
  const [lineLabel, setLineLabel] = useState('')
  const [lineAmount, setLineAmount] = useState('')
  const [reverseTarget, setReverseTarget] = useState<PaymentRow | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)

  if (bundle.isPending) return <LoadingState />
  if (bundle.isError || !bundle.data)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void bundle.refetch()}
      />
    )
  const { invoice, lines, payments, balance, childName } = bundle.data
  const settled = (balance?.balance ?? 0) <= 0 && invoice.status === 'issued'
  // حارس إلغاء الفاتورة (3A-363): دفعة حيّة (فعّالة أو معلّقة، غير معكوسة
  // وليست سطر عكس) تمنع الإلغاء — نفس قاعدة مشغّل القاعدة في هجرة 0013
  const hasBlockingPayments = payments.some(
    (p) =>
      !p.reversed_by_id && !p.reverses_id && p.proof_status !== 'rejected',
  )

  const lineTypeLabel = (type: InvoiceLineType): string =>
    type === 'base'
      ? t('invoices.lineTypeBase')
      : type === 'discount'
        ? t('invoices.lineTypeDiscount')
        : type === 'adjustment'
          ? t('invoices.lineTypeAdjustment')
          : type === 'bus'
            ? t('invoices.lineTypeBus')
            : t('invoices.lineTypeExtra')

  const methodLabel = (p: PaymentRow): string =>
    p.method === 'cash'
      ? t('invoices.methodCash')
      : p.method === 'vodafone_cash'
        ? t('invoices.methodVodafone')
        : p.method === 'instapay'
          ? t('invoices.methodInstapay')
          : t('invoices.methodBank')

  async function handleAddLine() {
    const amount = parseFloat(lineAmount)
    if (!lineLabel.trim() || Number.isNaN(amount)) return
    await mutations.addLine.mutateAsync({
      invoiceId: invoice.id,
      line: {
        type: lineType,
        label: lineLabel.trim(),
        amount: lineType === 'discount' ? -Math.abs(amount) : amount,
      },
    })
    setLineLabel('')
    setLineAmount('')
    setLineOpen(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <div className="type-title">{childName}</div>
            <div className="type-secondary text-muted">
              {t('invoices.period', { period: fmtPeriod(invoice.period) })}
              {invoice.status === 'cancelled' && ` — ${t('invoices.statusCancelled')}`}
              {invoice.status === 'draft' && ` — ${t('invoices.statusDraft')}`}
            </div>
          </div>
          {settled && (
            <span className="type-badge text-good-text bg-good-soft rounded-full px-2 py-1">
              {t('invoices.settled')}
            </span>
          )}
        </div>
        <div className="flex justify-around text-center mt-3">
          <div>
            <div className="type-badge text-muted">{t('invoices.total')}</div>
            <div className="type-section">{formatMoney(balance?.total ?? 0)}</div>
          </div>
          <div>
            <div className="type-badge text-muted">{t('invoices.paid')}</div>
            <div className="type-section text-good-text">
              {formatMoney(balance?.paid ?? 0)}
            </div>
          </div>
          <div>
            <div className="type-badge text-muted">{t('invoices.balance')}</div>
            <div className="type-section text-bad-text">
              {formatMoney(balance?.balance ?? 0)}
            </div>
          </div>
        </div>
      </Card>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="type-section">{t('common.details')}</h2>
          {invoice.status === 'issued' && (
            <Button variant="ghost" size="sm" onClick={() => setLineOpen(true)}>
              <Plus size={16} />
              {t('invoices.addLine')}
            </Button>
          )}
        </div>
        <Card className="flex flex-col divide-y divide-border py-1">
          {lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between py-2">
              <span className="type-body">
                {line.label}
                <span className="type-badge text-muted block">
                  {lineTypeLabel(line.type)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className={line.amount < 0 ? 'text-good-text' : undefined}>
                  {formatMoney(line.amount)}
                </span>
                {invoice.status === 'issued' && (
                  <button
                    className="text-bad-text cursor-pointer bg-transparent border-0"
                    aria-label={t('common.delete')}
                    onClick={() => void mutations.deleteLine.mutateAsync(line.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="type-section">{t('invoices.childPayments', { name: childName })}</h2>
          {invoice.status === 'issued' && (
            <Button variant="ghost" size="sm" onClick={() => setPayOpen(true)}>
              <Plus size={16} />
              {t('invoices.recordPayment')}
            </Button>
          )}
        </div>
        {payments.length === 0 ? (
          <p className="type-secondary text-muted">{t('invoices.noPayments')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {payments.map((p) => (
              <Card key={p.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="type-body">
                    {formatMoney(p.amount)} — {methodLabel(p)}
                    {p.receipt_no
                      ? ` • ${t('invoices.receiptNo', { no: p.receipt_no })}`
                      : ''}
                  </div>
                  <div className="type-badge text-muted">
                    {formatDateTimeAr(p.paid_at)}
                    {p.proof_status === 'pending' && ` • ${t('common.pendingReview')}`}
                    {p.reversed_by_id && ` • ${t('invoices.reversedBadge')}`}
                    {p.reverses_id && ` • ${t('invoices.reversesBadge', { no: '' })}`}
                  </div>
                </div>
                {!p.reversed_by_id && !p.reverses_id && p.proof_status !== 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReverseTarget(p)}
                    aria-label={t('invoices.reversePayment')}
                  >
                    <RotateCcw size={16} />
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {invoice.status !== 'cancelled' &&
        (hasBlockingPayments ? (
          <p className="type-secondary text-muted">
            {t('invoices.cancelBlockedHasPayments')}
          </p>
        ) : (
          <Button variant="ghost" onClick={() => setCancelOpen(true)}>
            {t('invoices.cancelInvoice')}
          </Button>
        ))}

      <RecordPaymentSheet
        open={payOpen}
        onClose={() => setPayOpen(false)}
        childId={invoice.child_id}
        invoiceId={invoice.id}
        suggestedAmount={balance?.balance ?? undefined}
      />

      <Sheet
        open={lineOpen}
        onClose={() => setLineOpen(false)}
        title={t('invoices.addLine')}
        footer={
          <Button onClick={handleAddLine} disabled={mutations.addLine.isPending} full>
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('invoices.lineType')}>
            <Select
              value={lineType}
              onChange={(e) => setLineType(e.target.value as InvoiceLineType)}
            >
              {LINE_TYPES.map((lt) => (
                <option key={lt} value={lt}>
                  {lineTypeLabel(lt)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('invoices.lineLabel')}>
            <TextInput value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} />
          </Field>
          <Field label={t('common.amount')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={lineAmount}
              onChange={(e) => setLineAmount(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>

      <ConfirmSheet
        open={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        title={t('invoices.reversePayment')}
        body={t('invoices.reverseConfirm')}
        confirmLabel={t('invoices.reversePayment')}
        danger
        onConfirm={async () => {
          if (reverseTarget) await mutations.reversePayment.mutateAsync(reverseTarget)
          setReverseTarget(null)
        }}
      />
      <ConfirmSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('invoices.cancelInvoice')}
        body={t('common.dangerConfirmTitle')}
        confirmLabel={t('invoices.cancelInvoice')}
        danger
        onConfirm={async () => {
          await mutations.cancel.mutateAsync(invoice.id)
          setCancelOpen(false)
        }}
      />
    </div>
  )
}
