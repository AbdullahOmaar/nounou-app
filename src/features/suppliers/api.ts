import { requireSupabase } from '../../lib/supabase'
import type {
  PurchaseOrderRow,
  SupplierPaymentRow,
  SupplierRow,
} from '../../types/database'
import { logActivity } from '../settings/api'

export async function listSuppliers(nurseryId: string): Promise<SupplierRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('suppliers')
    .select('*')
    .eq('nursery_id', nurseryId)
    .order('name')
  if (error) throw error
  return (data ?? []) as SupplierRow[]
}

export async function addSupplier(
  nurseryId: string,
  actorId: string | null,
  input: { name: string; phone: string | null; credit_days: number; note: string | null },
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('suppliers').insert({
    nursery_id: nurseryId,
    name: input.name.trim(),
    phone: input.phone,
    credit_days: input.credit_days,
    note: input.note,
    created_by: actorId,
  })
  if (error) throw error
  await logActivity(nurseryId, actorId, 'supplier_added', input.name.trim())
}

export async function listOrders(supplierId: string): Promise<PurchaseOrderRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('purchase_orders')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('due_date')
  if (error) throw error
  return (data ?? []) as PurchaseOrderRow[]
}

export async function addOrder(
  nurseryId: string,
  actorId: string | null,
  supplier: SupplierRow,
  input: { title: string; total_amount: number; order_date: string; due_date: string },
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('purchase_orders').insert({
    nursery_id: nurseryId,
    supplier_id: supplier.id,
    title: input.title.trim(),
    total_amount: input.total_amount,
    order_date: input.order_date,
    due_date: input.due_date,
    created_by: actorId,
  })
  if (error) throw error
  await logActivity(
    nurseryId,
    actorId,
    'order_added',
    `${supplier.name} — ${input.title.trim()}`,
  )
}

export async function listPayments(orderId: string): Promise<SupplierPaymentRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('supplier_payments')
    .select('*')
    .eq('order_id', orderId)
    .order('paid_date')
  if (error) throw error
  return (data ?? []) as SupplierPaymentRow[]
}

/** كل دفعات الحضانة (لحساب المدفوع لكل أمر في طبقة العرض) */
export async function listNurseryPayments(
  nurseryId: string,
): Promise<SupplierPaymentRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('supplier_payments')
    .select('*')
    .eq('nursery_id', nurseryId)
  if (error) throw error
  return (data ?? []) as SupplierPaymentRow[]
}

/**
 * دفع أمر شراء: قيد دفعة + قيد خزنة مقابل في نفس اليوم (ref للدفعة)
 * — الدفعة تتدفق لإقفال الوردية ولربح الشهر (طبقة المالية تخصمها
 * من supplier_payments مباشرة، لا من جدول المصروفات: لا ازدواج).
 */
export async function payOrder(
  nurseryId: string,
  actorId: string | null,
  supplier: SupplierRow,
  order: PurchaseOrderRow,
  amount: number,
  paidDate: string,
): Promise<void> {
  const db = requireSupabase()
  const { data: entry, error: eErr } = await db
    .from('cashbox_entries')
    .insert({
      nursery_id: nurseryId,
      entry_date: paidDate,
      direction: 'out',
      kind: 'purchase',
      title: `${supplier.name} — ${order.title}`,
      amount,
      ref_type: 'supplier_payment',
      created_by: actorId,
    })
    .select('id')
    .single()
  if (eErr) throw eErr
  const entryId = (entry as { id: string }).id
  const { data: payment, error } = await db
    .from('supplier_payments')
    .insert({
      nursery_id: nurseryId,
      order_id: order.id,
      amount,
      paid_date: paidDate,
      cashbox_entry_id: entryId,
      created_by: actorId,
    })
    .select('id')
    .single()
  if (error) throw error
  await db
    .from('cashbox_entries')
    .update({ ref_id: (payment as { id: string }).id })
    .eq('id', entryId)
  await logActivity(
    nurseryId,
    actorId,
    'supplier_paid',
    `${supplier.name} — ${order.title} — ${amount}`,
  )
}

/** مجموع مدفوعات الموردين داخل فترة شهرية (لربح 419) */
export async function supplierPaidInPeriod(
  nurseryId: string,
  period: string,
): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('supplier_payments')
    .select('amount')
    .eq('nursery_id', nurseryId)
    .gte('paid_date', `${period}-01`)
    .lt('paid_date', nextPeriodStart(period))
  if (error) throw error
  return (data ?? []).reduce(
    (s, p) => s + Number((p as { amount: number }).amount),
    0,
  )
}

function nextPeriodStart(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`
}
