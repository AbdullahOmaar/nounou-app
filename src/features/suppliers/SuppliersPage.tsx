import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/form'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { useAuth } from '../../lib/AuthProvider'
import { formatMoney, todayISO } from '../../lib/format'
import { invalidatePrefixes } from '../../lib/invalidate'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import type { PurchaseOrderRow, SupplierRow } from '../../types/database'
import * as api from './api'

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * 1.4: دفتر الموردين والآجل — موردون + أوامر شراء باستحقاق + دفعات
 * تتدفق للخزنة والربح. للمالك فقط (RLS + بوابة واجهة).
 */
export function SuppliersPage() {
  const t = useT()
  const showToast = useToast()
  const { user } = useAuth()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const qc = useQueryClient()
  const today = todayISO()
  const [openSupplier, setOpenSupplier] = useState<string | null>(null)
  const [supplierSheet, setSupplierSheet] = useState(false)
  const [sName, setSName] = useState('')
  const [sPhone, setSPhone] = useState('')
  const [sCredit, setSCredit] = useState('0')
  const [orderSheet, setOrderSheet] = useState<SupplierRow | null>(null)
  const [oTitle, setOTitle] = useState('')
  const [oTotal, setOTotal] = useState('')
  const [oDate, setODate] = useState(today)
  const [oDue, setODue] = useState(today)
  const [paySheet, setPaySheet] = useState<{
    supplier: SupplierRow
    order: PurchaseOrderRow
    remaining: number
  } | null>(null)
  const [pAmount, setPAmount] = useState('')
  const [pDate, setPDate] = useState(today)

  const suppliers = useQuery({
    queryKey: ['suppliers', nurseryId],
    enabled: Boolean(nurseryId && isOwner),
    queryFn: () => api.listSuppliers(nurseryId!),
  })
  const orders = useQuery({
    queryKey: ['orders', openSupplier],
    enabled: Boolean(openSupplier),
    queryFn: () => api.listOrders(openSupplier!),
  })
  const payments = useQuery({
    queryKey: ['supplier-payments', nurseryId],
    enabled: Boolean(nurseryId && isOwner),
    queryFn: () => api.listNurseryPayments(nurseryId!),
  })
  const paidByOrder = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of payments.data ?? [])
      map.set(p.order_id, (map.get(p.order_id) ?? 0) + Number(p.amount))
    return map
  }, [payments.data])

  const refresh = () =>
    invalidatePrefixes(qc, ['suppliers', 'orders', 'supplier-payments', 'month-money', 'cashbox-entries'])
  const addSupplier = useMutation({
    mutationFn: () =>
      api.addSupplier(nurseryId!, user?.id ?? null, {
        name: sName,
        phone: sPhone.trim() || null,
        credit_days: parseInt(sCredit) || 0,
        note: null,
      }),
    onSuccess: () => {
      refresh()
      setSupplierSheet(false)
      setSName('')
      setSPhone('')
      setSCredit('0')
      showToast(t('suppliers.added'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const addOrder = useMutation({
    mutationFn: () =>
      api.addOrder(nurseryId!, user?.id ?? null, orderSheet!, {
        title: oTitle,
        total_amount: parseFloat(oTotal) || 0,
        order_date: oDate,
        due_date: oDue,
      }),
    onSuccess: () => {
      refresh()
      setOrderSheet(null)
      setOTitle('')
      setOTotal('')
      showToast(t('suppliers.orderAdded'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const pay = useMutation({
    mutationFn: () =>
      api.payOrder(
        nurseryId!,
        user?.id ?? null,
        paySheet!.supplier,
        paySheet!.order,
        parseFloat(pAmount) || 0,
        pDate,
      ),
    onSuccess: () => {
      refresh()
      setPaySheet(null)
      showToast(t('suppliers.paid'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  if (nursery.status !== 'ready') return <LoadingState />
  if (!isOwner)
    return <EmptyState title={t('finance.ownerOnly')} hint={t('finance.ownerOnlyBody')} />
  if (suppliers.isPending) return <LoadingState />
  if (suppliers.isError)
    return (
      <ErrorState message={t('common.errorGeneric')} onRetry={() => void suppliers.refetch()} />
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="type-title">{t('suppliers.title')}</h1>
        <Button size="sm" onClick={() => setSupplierSheet(true)}>
          <Plus size={16} />
          {t('suppliers.addSupplier')}
        </Button>
      </div>

      {(suppliers.data ?? []).length === 0 ? (
        <EmptyState title={t('suppliers.none')} />
      ) : (
        (suppliers.data ?? []).map((s) => (
          <Card key={s.id} className="flex flex-col gap-2">
            <button
              className="flex items-center justify-between cursor-pointer bg-transparent border-0 text-start p-0"
              onClick={() => setOpenSupplier(openSupplier === s.id ? null : s.id)}
            >
              <span className="type-body">{s.name}</span>
              <span className="type-badge text-muted">
                {s.credit_days > 0
                  ? t('suppliers.creditDays', { days: s.credit_days })
                  : t('suppliers.cashOnly')}
                {s.phone ? ` • ${s.phone}` : ''}
              </span>
            </button>
            {openSupplier === s.id && (
              <div className="flex flex-col gap-2">
                {(orders.data ?? []).length === 0 ? (
                  <p className="type-secondary text-muted">{t('suppliers.noOrders')}</p>
                ) : (
                  (orders.data ?? []).map((o) => {
                    const paid = paidByOrder.get(o.id) ?? 0
                    const remaining = Number(o.total_amount) - paid
                    const overdue = remaining > 0 && o.due_date < today
                    return (
                      <div
                        key={o.id}
                        className="flex items-center justify-between border-t border-border pt-2"
                      >
                        <span className="flex flex-col">
                          <span className="type-body">{o.title}</span>
                          <span className={overdue ? 'type-badge text-bad-text' : 'type-badge text-muted'}>
                            {t('suppliers.due', { date: o.due_date })} •{' '}
                            {t('suppliers.paidOf', {
                              paid: formatMoney(paid),
                              total: formatMoney(Number(o.total_amount)),
                            })}
                            {overdue ? ` • ${t('suppliers.overdue')}` : ''}
                          </span>
                        </span>
                        {remaining > 0 && (
                          <Button
                            size="sm"
                            variant="soft"
                            onClick={() => {
                              setPaySheet({ supplier: s, order: o, remaining })
                              setPAmount(String(remaining))
                              setPDate(today)
                            }}
                          >
                            {t('suppliers.pay')}
                          </Button>
                        )}
                      </div>
                    )
                  })
                )}
                <Button
                  variant="soft"
                  onClick={() => {
                    setOrderSheet(s)
                    setODate(today)
                    setODue(addDays(today, s.credit_days))
                  }}
                >
                  <Plus size={16} />
                  {t('suppliers.addOrder')}
                </Button>
              </div>
            )}
          </Card>
        ))
      )}

      <Sheet
        open={supplierSheet}
        onClose={() => setSupplierSheet(false)}
        title={t('suppliers.addSupplier')}
        footer={
          <Button full disabled={!sName.trim() || addSupplier.isPending} onClick={() => addSupplier.mutate()}>
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('suppliers.name')}>
            <TextInput value={sName} onChange={(e) => setSName(e.target.value)} />
          </Field>
          <Field label={t('suppliers.phone')}>
            <TextInput value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
          </Field>
          <Field label={t('suppliers.creditDaysField')}>
            <TextInput
              type="number"
              inputMode="numeric"
              value={sCredit}
              onChange={(e) => setSCredit(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(orderSheet)}
        onClose={() => setOrderSheet(null)}
        title={t('suppliers.addOrder')}
        footer={
          <Button
            full
            disabled={!oTitle.trim() || !(parseFloat(oTotal) > 0) || addOrder.isPending}
            onClick={() => addOrder.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('suppliers.orderTitle')}>
            <TextInput value={oTitle} onChange={(e) => setOTitle(e.target.value)} />
          </Field>
          <Field label={t('finance.amount')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={oTotal}
              onChange={(e) => setOTotal(e.target.value)}
            />
          </Field>
          <Field label={t('suppliers.orderDate')}>
            <TextInput
              type="date"
              value={oDate}
              onChange={(e) => {
                setODate(e.target.value)
                if (orderSheet) setODue(addDays(e.target.value, orderSheet.credit_days))
              }}
            />
          </Field>
          <Field label={t('suppliers.dueDate')}>
            <TextInput type="date" value={oDue} onChange={(e) => setODue(e.target.value)} />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(paySheet)}
        onClose={() => setPaySheet(null)}
        title={t('suppliers.pay')}
        footer={
          <Button
            full
            disabled={!(parseFloat(pAmount) > 0) || pay.isPending}
            onClick={() => pay.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('finance.amount')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={pAmount}
              onChange={(e) => setPAmount(e.target.value)}
            />
          </Field>
          <Field label={t('suppliers.payDate')}>
            <TextInput type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
          </Field>
          <p className="type-badge text-muted">{t('suppliers.payHint')}</p>
        </div>
      </Sheet>
    </div>
  )
}
