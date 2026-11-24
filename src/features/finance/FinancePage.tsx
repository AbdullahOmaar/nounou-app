import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, TextInput } from '../../components/ui/form'
import { ConfirmSheet } from '../../components/ui/ConfirmSheet'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { useAuth } from '../../lib/AuthProvider'
import { formatMoney, todayISO } from '../../lib/format'
import { invalidatePrefixes } from '../../lib/invalidate'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useChildren } from '../children/hooks'
import type { ExpenseCategory, NurseryExpenseRow } from '../../types/database'
import * as api from './api'

function catLabel(t: ReturnType<typeof useT>, c: ExpenseCategory): string {
  switch (c) {
    case 'salaries':
      return t('finance.cat.salaries')
    case 'rent':
      return t('finance.cat.rent')
    case 'food':
      return t('finance.cat.food')
    case 'transport':
      return t('finance.cat.transport')
    case 'supplies':
      return t('finance.cat.supplies')
    case 'maintenance':
      return t('finance.cat.maintenance')
    case 'other':
      return t('finance.cat.misc')
  }
}

function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 419 (1.2): المصروفات التشغيلية وربح الشهر + خزنة اليوم — للمالك
 * فقط (RLS + بوابة واجهة). المال أونلاين فقط بقرار 1.1: لا طابور.
 */
export function FinancePage() {
  const t = useT()
  const showToast = useToast()
  const { user } = useAuth()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const qc = useQueryClient()
  const [period, setPeriod] = useState(() => todayISO().slice(0, 7))
  const [addOpen, setAddOpen] = useState(false)
  const [date, setDate] = useState(() => todayISO())
  const [category, setCategory] = useState<ExpenseCategory>('other')
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<NurseryExpenseRow | null>(null)
  const today = todayISO()

  const expenses = useQuery({
    queryKey: ['expenses', nurseryId, period],
    enabled: Boolean(nurseryId && isOwner),
    queryFn: () => api.listExpenses(nurseryId!, period),
  })
  const money = useQuery({
    queryKey: ['month-money', nurseryId, period, expenses.data],
    enabled: Boolean(nurseryId && isOwner && expenses.data),
    queryFn: () => api.monthMoney(nurseryId!, period, expenses.data ?? []),
  })
  const children = useChildren()
  const childNames = useMemo(
    () => new Map((children.data ?? []).map((c) => [c.id, c.full_name])),
    [children.data],
  )
  const cashbox = useQuery({
    queryKey: ['day-cashbox', nurseryId, today, childNames],
    enabled: Boolean(nurseryId && isOwner),
    queryFn: () => api.dayCashbox(nurseryId!, today, childNames),
  })

  const refresh = () =>
    invalidatePrefixes(qc, ['expenses', 'month-money', 'day-cashbox', 'home'])
  const add = useMutation({
    mutationFn: () =>
      api.addExpense(nurseryId!, user?.id ?? null, {
        expense_date: date,
        category,
        title,
        amount: parseFloat(amount) || 0,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      refresh()
      setAddOpen(false)
      setTitle('')
      setAmount('')
      setNote('')
      showToast(t('finance.added'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const remove = useMutation({
    mutationFn: (e: NurseryExpenseRow) =>
      api.deleteExpense(nurseryId!, user?.id ?? null, e),
    onSuccess: () => {
      refresh()
      setDeleteTarget(null)
      showToast(t('finance.deleted'))
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  if (nursery.status !== 'ready') return <LoadingState />
  if (!isOwner)
    return <EmptyState title={t('finance.ownerOnly')} hint={t('finance.ownerOnlyBody')} />
  if (expenses.isPending) return <LoadingState />
  if (expenses.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void expenses.refetch()}
      />
    )

  const m = money.data
  const cb = cashbox.data
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="type-title">{t('finance.title')}</h1>
        <span className="flex gap-1.5">
          <Button size="sm" variant="soft" onClick={() => setPeriod(shiftPeriod(period, -1))}>
            ‹
          </Button>
          <span className="type-body px-1">{period}</span>
          <Button size="sm" variant="soft" onClick={() => setPeriod(shiftPeriod(period, 1))}>
            ›
          </Button>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="text-center py-3">
          <div className="type-title">{formatMoney(m?.income ?? 0)}</div>
          <div className="type-badge text-muted">{t('finance.income')}</div>
        </Card>
        <Card className="text-center py-3">
          <div className="type-title">{formatMoney(m?.expensesTotal ?? 0)}</div>
          <div className="type-badge text-muted">{t('finance.expensesTotal')}</div>
        </Card>
        <Card className="text-center py-3">
          <div className="type-title">{formatMoney(m?.profit ?? 0)}</div>
          <div className="type-badge text-muted">{t('finance.profit')}</div>
        </Card>
      </div>

      {m && m.byCategory.length > 0 && (
        <Card>
          <div className="type-section mb-2">{t('finance.byCategory')}</div>
          <div className="flex flex-col gap-1">
            {m.byCategory.map((c) => (
              <div key={c.category} className="flex items-center justify-between">
                <span className="type-body">{catLabel(t, c.category)}</span>
                <span className="type-body">{formatMoney(c.total)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="type-section">{t('finance.expensesTitle')}</h2>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={16} />
            {t('finance.addExpense')}
          </Button>
        </div>
        {(expenses.data ?? []).length === 0 ? (
          <EmptyState title={t('finance.noExpenses')} />
        ) : (
          <div className="flex flex-col gap-2">
            {(expenses.data ?? []).map((e) => (
              <Card key={e.id} className="flex items-center justify-between py-3">
                <span className="flex flex-col">
                  <span className="type-body">{e.title}</span>
                  <span className="type-badge text-muted">
                    {catLabel(t, e.category)} • {e.expense_date}
                    {e.note ? ` • ${e.note}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="type-body">{formatMoney(Number(e.amount))}</span>
                  <button
                    className="w-9 h-9 flex items-center justify-center cursor-pointer bg-transparent border-0 text-bad-text"
                    aria-label={t('common.delete')}
                    onClick={() => setDeleteTarget(e)}
                  >
                    <Trash2 size={17} />
                  </button>
                </span>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="type-section mb-2">{t('finance.cashboxToday')}</h2>
        <Card>
          <div className="grid grid-cols-3 gap-2 text-center mb-2">
            <div>
              <div className="type-body">{formatMoney(cb?.inTotal ?? 0)}</div>
              <div className="type-badge text-muted">{t('finance.in')}</div>
            </div>
            <div>
              <div className="type-body">{formatMoney(cb?.outTotal ?? 0)}</div>
              <div className="type-badge text-muted">{t('finance.out')}</div>
            </div>
            <div>
              <div className="type-body">{formatMoney(cb?.net ?? 0)}</div>
              <div className="type-badge text-muted">{t('finance.net')}</div>
            </div>
          </div>
          {(cb?.movements ?? []).length === 0 ? (
            <p className="type-secondary text-muted">{t('finance.noMovements')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {(cb?.movements ?? []).map((mv, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="type-secondary">{mv.label}</span>
                  <span className={mv.direction === 'in' ? 'type-body' : 'type-body text-bad-text'}>
                    {mv.direction === 'in' ? '+' : '−'} {formatMoney(mv.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t('finance.addExpense')}
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
          <Field label={t('finance.date')}>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('finance.category')}>
            <ChipRow>
              {api.EXPENSE_CATEGORIES.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {catLabel(t, c)}
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
          <Field label={t('finance.note')}>
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Sheet>

      <ConfirmSheet
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('finance.deleteConfirm')}
        body={deleteTarget ? `${deleteTarget.title} — ${formatMoney(Number(deleteTarget.amount))}` : ''}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget)
        }}
      />
    </div>
  )
}
