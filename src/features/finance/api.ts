import { requireSupabase } from '../../lib/supabase'
import type {
  CashboxCloseRow,
  CashboxEntryRow,
  CashboxKind,
  ExpenseCategory,
  NurseryExpenseRow,
} from '../../types/database'
import { logActivity } from '../settings/api'

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'salaries',
  'rent',
  'food',
  'transport',
  'supplies',
  'maintenance',
  'other',
]

export interface ExpenseInput {
  expense_date: string
  category: ExpenseCategory
  title: string
  amount: number
  note: string | null
}

export async function listExpenses(
  nurseryId: string,
  period: string,
): Promise<NurseryExpenseRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nursery_expenses')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('period', period)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as NurseryExpenseRow[]
}

export async function addExpense(
  nurseryId: string,
  actorId: string | null,
  input: ExpenseInput,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_expenses').insert({
    nursery_id: nurseryId,
    period: input.expense_date.slice(0, 7),
    expense_date: input.expense_date,
    category: input.category,
    title: input.title.trim(),
    amount: input.amount,
    note: input.note,
    created_by: actorId,
  })
  if (error) throw error
  await logActivity(
    nurseryId,
    actorId,
    'expense_recorded',
    `${input.title.trim()} — ${input.amount}`,
  )
}

export async function deleteExpense(
  nurseryId: string,
  actorId: string | null,
  expense: NurseryExpenseRow,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_expenses').delete().eq('id', expense.id)
  if (error) throw error
  await logActivity(
    nurseryId,
    actorId,
    'expense_deleted',
    `${expense.title} — ${expense.amount}`,
  )
}

interface MoneyPayment {
  amount: number
  paid_at: string
  child_id: string
}

/** دفعات صالحة مالياً: معتمدة/لا تحتاج إثباتاً، ليست عكساً ولا معكوسة */
async function validPayments(
  nurseryId: string,
  fromISO: string,
  toISO: string,
): Promise<MoneyPayment[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('payments')
    .select('amount, paid_at, child_id')
    .eq('nursery_id', nurseryId)
    .gte('paid_at', fromISO)
    .lt('paid_at', toISO)
    .in('proof_status', ['approved', 'not_required'])
    .is('reverses_id', null)
    .is('reversed_by_id', null)
  if (error) throw error
  return (data ?? []) as MoneyPayment[]
}

export interface MonthMoney {
  income: number
  expensesTotal: number
  /** مدفوعات الموردين في الشهر (1.4) — تُخصم من الربح هنا لا من جدول المصروفات */
  supplierPaid: number
  profit: number
  byCategory: { category: ExpenseCategory; total: number }[]
}

/** صورة مال الشهر: دخل الدفعات − المصروفات = الربح (419) */
export async function monthMoney(
  nurseryId: string,
  period: string,
  expenses: NurseryExpenseRow[],
): Promise<MonthMoney> {
  const [y, m] = period.split('-').map(Number)
  const from = `${period}-01T00:00:00`
  const to =
    m === 12 ? `${y + 1}-01-01T00:00:00` : `${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00`
  const payments = await validPayments(nurseryId, from, to)
  const income = payments.reduce((s, p) => s + Number(p.amount), 0)
  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const { supplierPaidInPeriod } = await import('../suppliers/api')
  const supplierPaid = await supplierPaidInPeriod(nurseryId, period)
  const byCategory = EXPENSE_CATEGORIES.map((category) => ({
    category,
    total: expenses
      .filter((e) => e.category === category)
      .reduce((s, e) => s + Number(e.amount), 0),
  })).filter((c) => c.total > 0)
  return {
    income,
    expensesTotal,
    supplierPaid,
    profit: income - expensesTotal - supplierPaid,
    byCategory,
  }
}

export interface DayCashbox {
  inTotal: number
  outTotal: number
  net: number
  movements: { label: string; amount: number; direction: 'in' | 'out' }[]
}

/** خزنة اليوم (عرض محسوب): داخل الدفعات − خارج المصروفات (419) */
export async function dayCashbox(
  nurseryId: string,
  dateISO: string,
  childNames: Map<string, string>,
): Promise<DayCashbox> {
  const db = requireSupabase()
  const payments = await validPayments(
    nurseryId,
    `${dateISO}T00:00:00`,
    `${dateISO}T23:59:59.999`,
  )
  const { data, error } = await db
    .from('nursery_expenses')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('expense_date', dateISO)
    .order('created_at')
  if (error) throw error
  const expenses = (data ?? []) as NurseryExpenseRow[]
  const inTotal = payments.reduce((s, p) => s + Number(p.amount), 0)
  const outTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const movements: DayCashbox['movements'] = [
    ...payments.map((p) => ({
      label: childNames.get(p.child_id) ?? '',
      amount: Number(p.amount),
      direction: 'in' as const,
    })),
    ...expenses.map((e) => ({
      label: e.title,
      amount: Number(e.amount),
      direction: 'out' as const,
    })),
  ]
  return { inTotal, outTotal, net: inTotal - outTotal, movements }
}

// ---------------------------------------------------------------------------
// دفتر الخزنة وإقفال الوردية (مهمة 1.3)

export async function listCashboxEntries(
  nurseryId: string,
  dateISO: string,
): Promise<CashboxEntryRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('cashbox_entries')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('entry_date', dateISO)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as CashboxEntryRow[]
}

export async function addCashboxEntry(
  nurseryId: string,
  actorId: string | null,
  input: {
    entry_date: string
    kind: CashboxKind
    title: string
    amount: number
  },
): Promise<void> {
  const db = requireSupabase()
  const direction = input.kind === 'sale' || input.kind === 'misc_in' ? 'in' : 'out'
  const { error } = await db.from('cashbox_entries').insert({
    nursery_id: nurseryId,
    entry_date: input.entry_date,
    direction,
    kind: input.kind,
    title: input.title.trim(),
    amount: input.amount,
    created_by: actorId,
  })
  if (error) throw error
  await logActivity(
    nurseryId,
    actorId,
    'cashbox_entry_added',
    `${input.title.trim()} — ${input.amount}`,
  )
}

export async function deleteCashboxEntry(
  nurseryId: string,
  actorId: string | null,
  entry: CashboxEntryRow,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('cashbox_entries').delete().eq('id', entry.id)
  if (error) throw error
  await logActivity(
    nurseryId,
    actorId,
    'cashbox_entry_deleted',
    `${entry.title} — ${entry.amount}`,
  )
}

export async function getCashboxClose(
  nurseryId: string,
  dateISO: string,
): Promise<CashboxCloseRow | null> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('cashbox_closes')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('shift_date', dateISO)
    .maybeSingle()
  if (error) throw error
  return (data as CashboxCloseRow | null) ?? null
}

export interface CloseBreakdown {
  cashPayments: number
  ledgerIn: number
  ledgerOut: number
  expensesOut: number
  expected: number
}

/** المتوقع في الدرج: دفعات نقدية + داخل الدفتر − خارج الدفتر − مصروفات اليوم */
export async function closeBreakdown(
  nurseryId: string,
  dateISO: string,
  entries: CashboxEntryRow[],
): Promise<CloseBreakdown> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('payments')
    .select('amount')
    .eq('nursery_id', nurseryId)
    .eq('method', 'cash')
    .gte('paid_at', `${dateISO}T00:00:00`)
    .lt('paid_at', `${dateISO}T23:59:59.999`)
    .in('proof_status', ['approved', 'not_required'])
    .is('reverses_id', null)
    .is('reversed_by_id', null)
  if (error) throw error
  const cashPayments = (data ?? []).reduce(
    (s, p) => s + Number((p as { amount: number }).amount),
    0,
  )
  const { data: expData, error: expErr } = await db
    .from('nursery_expenses')
    .select('amount')
    .eq('nursery_id', nurseryId)
    .eq('expense_date', dateISO)
  if (expErr) throw expErr
  const expensesOut = (expData ?? []).reduce(
    (s, e) => s + Number((e as { amount: number }).amount),
    0,
  )
  const ledgerIn = entries
    .filter((e) => e.direction === 'in')
    .reduce((s, e) => s + Number(e.amount), 0)
  const ledgerOut = entries
    .filter((e) => e.direction === 'out')
    .reduce((s, e) => s + Number(e.amount), 0)
  return {
    cashPayments,
    ledgerIn,
    ledgerOut,
    expensesOut,
    expected: cashPayments + ledgerIn - ledgerOut - expensesOut,
  }
}

export async function closeCashbox(
  nurseryId: string,
  actorId: string | null,
  dateISO: string,
  expected: number,
  counted: number,
  handoverTo: string,
  note: string | null,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('cashbox_closes').insert({
    nursery_id: nurseryId,
    shift_date: dateISO,
    expected_total: expected,
    counted_total: counted,
    difference: counted - expected,
    handover_to: handoverTo.trim(),
    note,
    closed_by: actorId,
  })
  if (error) throw error
  await logActivity(
    nurseryId,
    actorId,
    'cashbox_closed',
    `${dateISO} → ${handoverTo.trim()}`,
  )
}
