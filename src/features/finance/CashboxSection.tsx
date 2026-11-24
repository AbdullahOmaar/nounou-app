import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Printer, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, TextInput } from '../../components/ui/form'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { formatMoney, todayISO } from '../../lib/format'
import { invalidatePrefixes } from '../../lib/invalidate'
import type { CashboxEntryRow, CashboxKind } from '../../types/database'
import * as api from './api'

const KINDS: CashboxKind[] = ['purchase', 'sale', 'misc_in', 'misc_out']

function kindLabel(t: ReturnType<typeof useT>, k: CashboxKind): string {
  switch (k) {
    case 'purchase':
      return t('finance.kind.purchase')
    case 'sale':
      return t('finance.kind.sale')
    case 'misc_in':
      return t('finance.kind.misc_in')
    case 'misc_out':
      return t('finance.kind.misc_out')
  }
}

/**
 * 1.3: دفتر الخزنة اليومي + إقفال الوردية برسالة تسليم موثّقة.
 * اليوم المقفل مجمّد خادمياً (مشغّل 0023) — الواجهة تعكس ذلك.
 */
export function CashboxSection({
  nurseryId,
  actorId,
}: {
  nurseryId: string
  actorId: string | null
}) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const [date, setDate] = useState(() => todayISO())
  const [addOpen, setAddOpen] = useState(false)
  const [kind, setKind] = useState<CashboxKind>('purchase')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [closeOpen, setCloseOpen] = useState(false)
  const [counted, setCounted] = useState('')
  const [handover, setHandover] = useState('')
  const [closeNote, setCloseNote] = useState('')

  const entries = useQuery({
    queryKey: ['cashbox-entries', nurseryId, date],
    queryFn: () => api.listCashboxEntries(nurseryId, date),
  })
  const close = useQuery({
    queryKey: ['cashbox-close', nurseryId, date],
    queryFn: () => api.getCashboxClose(nurseryId, date),
  })
  const breakdown = useQuery({
    queryKey: ['cashbox-breakdown', nurseryId, date, entries.data],
    enabled: Boolean(entries.data) && !close.data,
    queryFn: () => api.closeBreakdown(nurseryId, date, entries.data ?? []),
  })
  const refresh = () =>
    invalidatePrefixes(qc, ['cashbox-entries', 'cashbox-close', 'cashbox-breakdown', 'day-cashbox'])

  const add = useMutation({
    mutationFn: () =>
      api.addCashboxEntry(nurseryId, actorId, {
        entry_date: date,
        kind,
        title,
        amount: parseFloat(amount) || 0,
      }),
    onSuccess: () => {
      refresh()
      setAddOpen(false)
      setTitle('')
      setAmount('')
      showToast(t('finance.entryAdded'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const remove = useMutation({
    mutationFn: (e: CashboxEntryRow) => api.deleteCashboxEntry(nurseryId, actorId, e),
    onSuccess: refresh,
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const doClose = useMutation({
    mutationFn: () =>
      api.closeCashbox(
        nurseryId,
        actorId,
        date,
        breakdown.data?.expected ?? 0,
        parseFloat(counted) || 0,
        handover,
        closeNote.trim() || null,
      ),
    onSuccess: () => {
      refresh()
      setCloseOpen(false)
      showToast(t('finance.closedOk'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  const rows = entries.data ?? []
  const c = close.data
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="type-section">{t('finance.ledgerTitle')}</h2>
        <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {c ? (
        <Card className="handover-print flex flex-col gap-1">
          <style>{`@media print { body * { visibility: hidden; } .handover-print, .handover-print * { visibility: visible; } .handover-print { position: absolute; inset: 0; } }`}</style>
          <div className="flex items-center justify-between">
            <span className="type-body flex items-center gap-1.5">
              <Lock size={16} />
              {t('finance.handoverTitle')} — {c.shift_date}
            </span>
            <button
              className="w-9 h-9 flex items-center justify-center cursor-pointer bg-transparent border-0"
              aria-label={t('finance.printHandover')}
              onClick={() => window.print()}
            >
              <Printer size={17} />
            </button>
          </div>
          <div className="type-secondary">
            {t('finance.expected')}: {formatMoney(Number(c.expected_total))}
          </div>
          <div className="type-secondary">
            {t('finance.counted')}: {formatMoney(Number(c.counted_total))}
          </div>
          <div className={Number(c.difference) !== 0 ? 'type-body text-bad-text' : 'type-secondary'}>
            {t('finance.difference')}: {formatMoney(Number(c.difference))}
          </div>
          <div className="type-secondary">
            {t('finance.handoverTo')}: {c.handover_to}
          </div>
          {c.note && <div className="type-secondary">{c.note}</div>}
        </Card>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="type-secondary text-muted mb-2">{t('finance.noEntries')}</p>
          ) : (
            <div className="flex flex-col gap-2 mb-2">
              {rows.map((e) => (
                <Card key={e.id} className="flex items-center justify-between py-3">
                  <span className="flex flex-col">
                    <span className="type-body">{e.title}</span>
                    <span className="type-badge text-muted">{kindLabel(t, e.kind)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={e.direction === 'in' ? 'type-body' : 'type-body text-bad-text'}>
                      {e.direction === 'in' ? '+' : '−'} {formatMoney(Number(e.amount))}
                    </span>
                    <button
                      className="w-9 h-9 flex items-center justify-center cursor-pointer bg-transparent border-0 text-bad-text"
                      aria-label={t('common.delete')}
                      onClick={() => remove.mutate(e)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </span>
                </Card>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="soft" className="flex-1" onClick={() => setAddOpen(true)}>
              <Plus size={16} />
              {t('finance.addEntry')}
            </Button>
            <Button className="flex-1" onClick={() => setCloseOpen(true)}>
              <Lock size={16} />
              {t('finance.closeShift')}
            </Button>
          </div>
        </>
      )}

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t('finance.addEntry')}
        footer={
          <Button
            full
            disabled={!title.trim() || !(parseFloat(amount) > 0) || add.isPending}
            onClick={() => add.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('finance.entryKind')}>
            <ChipRow>
              {KINDS.map((k) => (
                <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
                  {kindLabel(t, k)}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          <Field label={t('finance.expenseTitle')}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('finance.amount')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={t('finance.closeShift')}
        footer={
          <Button
            full
            disabled={!handover.trim() || counted === '' || doClose.isPending}
            onClick={() => doClose.mutate()}
          >
            {t('finance.closeConfirm')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {breakdown.data && (
            <Card className="flex flex-col gap-1">
              <div className="type-secondary">
                {t('finance.bdCash')}: {formatMoney(breakdown.data.cashPayments)}
              </div>
              <div className="type-secondary">
                {t('finance.bdIn')}: {formatMoney(breakdown.data.ledgerIn)}
              </div>
              <div className="type-secondary">
                {t('finance.bdOut')}: {formatMoney(breakdown.data.ledgerOut)}
              </div>
              <div className="type-secondary">
                {t('finance.bdExpenses')}: {formatMoney(breakdown.data.expensesOut)}
              </div>
              <div className="type-body">
                {t('finance.expected')}: {formatMoney(breakdown.data.expected)}
              </div>
            </Card>
          )}
          <Field label={t('finance.counted')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
            />
          </Field>
          <Field label={t('finance.handoverTo')}>
            <TextInput value={handover} onChange={(e) => setHandover(e.target.value)} />
          </Field>
          <Field label={t('finance.note')}>
            <TextInput value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
          </Field>
          <p className="type-badge text-muted">{t('finance.closeWarning')}</p>
        </div>
      </Sheet>
    </section>
  )
}
