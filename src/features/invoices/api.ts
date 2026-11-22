import { requireSupabase } from '../../lib/supabase'
import { t } from '../../i18n'
import type {
  InvoiceBalanceRow,
  InvoiceLineRow,
  InvoiceRow,
  PaymentMethod,
  PaymentRow,
} from '../../types/database'
import { planMonthlyIssue, type IssueChildInput, type PlannedLine } from './issuePlan'

export interface InvoiceListItem extends InvoiceRow {
  childName: string
  total: number
  paid: number
  balance: number
}

export async function listInvoices(
  nurseryId: string,
  period: string,
): Promise<InvoiceListItem[]> {
  const db = requireSupabase()
  const [invRes, balRes, childrenRes] = await Promise.all([
    db
      .from('invoices')
      .select('*')
      .eq('nursery_id', nurseryId)
      .eq('period', period)
      .order('created_at'),
    db.from('invoice_balances').select('*').eq('nursery_id', nurseryId).eq('period', period),
    db.from('children').select('id, full_name').eq('nursery_id', nurseryId),
  ])
  if (invRes.error) throw invRes.error
  if (balRes.error) throw balRes.error
  if (childrenRes.error) throw childrenRes.error
  const balances = new Map(
    ((balRes.data ?? []) as InvoiceBalanceRow[]).map((b) => [b.invoice_id, b]),
  )
  const names = new Map(
    (childrenRes.data ?? []).map((c) => [c.id as string, c.full_name as string]),
  )
  return ((invRes.data ?? []) as InvoiceRow[]).map((inv) => {
    const b = balances.get(inv.id)
    return {
      ...inv,
      childName: names.get(inv.child_id) ?? '',
      total: b?.total ?? 0,
      paid: b?.paid ?? 0,
      balance: b?.balance ?? 0,
    }
  })
}

export interface InvoiceBundle {
  invoice: InvoiceRow
  lines: InvoiceLineRow[]
  payments: PaymentRow[]
  balance: InvoiceBalanceRow | null
  childName: string
}

export async function getInvoiceBundle(invoiceId: string): Promise<InvoiceBundle> {
  const db = requireSupabase()
  const { data: invoice, error } = await db
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()
  if (error) throw error
  const inv = invoice as InvoiceRow
  const [linesRes, paymentsRes, balRes, childRes] = await Promise.all([
    db.from('invoice_lines').select('*').eq('invoice_id', invoiceId).order('created_at'),
    db
      .from('payments')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('paid_at', { ascending: false }),
    db.from('invoice_balances').select('*').eq('invoice_id', invoiceId).maybeSingle(),
    db.from('children').select('full_name').eq('id', inv.child_id).single(),
  ])
  if (linesRes.error) throw linesRes.error
  if (paymentsRes.error) throw paymentsRes.error
  if (balRes.error) throw balRes.error
  if (childRes.error) throw childRes.error
  return {
    invoice: inv,
    lines: (linesRes.data ?? []) as InvoiceLineRow[],
    payments: (paymentsRes.data ?? []) as PaymentRow[],
    balance: (balRes.data as InvoiceBalanceRow | null) ?? null,
    childName: (childRes.data as { full_name: string }).full_name,
  }
}

function lineLabel(line: PlannedLine): string {
  switch (line.labelKey) {
    case 'base':
      return t('invoices.lineBase', line.labelParams)
    case 'bus':
      return t('invoices.lineBus', line.labelParams)
    case 'discountSibling':
      return t('invoices.lineDiscountSibling', line.labelParams)
  }
}

/**
 * الإصدار الجماعي الشهري: يقرأ التسجيلات النشطة + اشتراكات الباص +
 * أصحاب الدفع + نسبة الخصم، يخطط بالمنطق النقي، ثم يُدرج الفواتير
 * وبنودها (صادرة مباشرة). أطفال عندهم فاتورة غير ملغاة للشهر يُتخطّون.
 */
export async function issueMonthlyInvoices(
  nurseryId: string,
  period: string,
  dueDate: string | null,
  actorId: string | null,
): Promise<{ issued: number; skipped: number }> {
  const db = requireSupabase()
  const [settingsRes, enrollRes, subsRes, linksRes, existingRes] = await Promise.all([
    db
      .from('nursery_settings')
      .select('sibling_discount_percent')
      .eq('nursery_id', nurseryId)
      .single(),
    db
      .from('enrollments')
      .select(
        'child_id, price_override, class:classes(name, monthly_fee), child:children(full_name)',
      )
      .eq('nursery_id', nurseryId)
      .eq('status', 'active'),
    db
      .from('bus_subscriptions')
      .select('child_id, monthly_fee, route:bus_routes(name)')
      .eq('nursery_id', nurseryId)
      .eq('is_active', true),
    db.from('guardian_children').select('child_id, guardian_id').eq('is_payer', true),
    db
      .from('invoices')
      .select('child_id')
      .eq('nursery_id', nurseryId)
      .eq('period', period)
      .neq('status', 'cancelled'),
  ])
  if (settingsRes.error) throw settingsRes.error
  if (enrollRes.error) throw enrollRes.error
  if (subsRes.error) throw subsRes.error
  if (linksRes.error) throw linksRes.error
  if (existingRes.error) throw existingRes.error

  const discount = Number(
    (settingsRes.data as { sibling_discount_percent: number }).sibling_discount_percent,
  )
  const busByChild = new Map<string, { routeName: string; fee: number }[]>()
  for (const s of subsRes.data ?? []) {
    const row = s as unknown as {
      child_id: string
      monthly_fee: number
      route: { name: string } | null
    }
    const arr = busByChild.get(row.child_id) ?? []
    arr.push({ routeName: row.route?.name ?? '', fee: Number(row.monthly_fee) })
    busByChild.set(row.child_id, arr)
  }
  const payerByChild = new Map(
    (linksRes.data ?? []).map((l) => [l.child_id as string, l.guardian_id as string]),
  )

  const inputs: IssueChildInput[] = (enrollRes.data ?? []).map((e) => {
    const row = e as unknown as {
      child_id: string
      price_override: number | null
      class: { name: string; monthly_fee: number } | null
      child: { full_name: string } | null
    }
    return {
      childId: row.child_id,
      childName: row.child?.full_name ?? '',
      className: row.class?.name ?? '',
      baseFee: Number(row.price_override ?? row.class?.monthly_fee ?? 0),
      payerGuardianId: payerByChild.get(row.child_id) ?? null,
      busLines: busByChild.get(row.child_id) ?? [],
    }
  })

  const already = new Set((existingRes.data ?? []).map((i) => i.child_id as string))
  const { plans, skipped } = planMonthlyIssue(inputs, discount, already)

  for (const plan of plans) {
    const { data: inv, error } = await db
      .from('invoices')
      .insert({
        nursery_id: nurseryId,
        child_id: plan.childId,
        period,
        status: 'issued',
        due_date: dueDate,
        created_by: actorId,
      })
      .select('id')
      .single()
    if (error) throw error
    const invoiceId = (inv as { id: string }).id
    const { error: linesErr } = await db.from('invoice_lines').insert(
      plan.lines.map((l) => ({
        nursery_id: nurseryId,
        invoice_id: invoiceId,
        type: l.type,
        label: lineLabel(l),
        amount: l.amount,
      })),
    )
    if (linesErr) throw linesErr
  }
  return { issued: plans.length, skipped: skipped.length }
}

export async function addInvoiceLine(
  nurseryId: string,
  invoiceId: string,
  line: { type: InvoiceLineRow['type']; label: string; amount: number },
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('invoice_lines').insert({
    nursery_id: nurseryId,
    invoice_id: invoiceId,
    ...line,
  })
  if (error) throw error
}

export async function deleteInvoiceLine(lineId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('invoice_lines').delete().eq('id', lineId)
  if (error) throw error
}

export async function cancelInvoice(invoiceId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', invoiceId)
  if (error) throw error
}

export interface RecordPaymentInput {
  invoice_id: string | null
  child_id: string
  amount: number
  method: PaymentMethod
  proof_file: File | null
}

/**
 * تسجيل دفعة من الإدارة: نقدي بلا إثبات؛ إلكتروني يقبله المالك مباشرة
 * (proof_status='approved' إن أرفق صورة، وإلا not_required لأنه قبضٌ
 * موثّق من المالك نفسه). رقم الإيصال من عدّاد القاعدة الذرّي.
 */
export async function recordPayment(
  nurseryId: string,
  actorId: string | null,
  input: RecordPaymentInput,
): Promise<void> {
  const db = requireSupabase()
  const { data: receiptNo, error: rErr } = await db.rpc('next_receipt_no', {
    p_nursery: nurseryId,
  })
  if (rErr) throw rErr

  let proofPath: string | null = null
  const paymentId = crypto.randomUUID()
  if (input.proof_file) {
    const ext = input.proof_file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    proofPath = `${nurseryId}/${paymentId}.${ext}`
    const { error: upErr } = await db.storage
      .from('payment-proofs')
      .upload(proofPath, input.proof_file, { upsert: false })
    if (upErr) throw upErr
  }

  const { error } = await db.from('payments').insert({
    id: paymentId,
    nursery_id: nurseryId,
    invoice_id: input.invoice_id,
    child_id: input.child_id,
    amount: input.amount,
    method: input.method,
    receipt_no: receiptNo as number,
    proof_path: proofPath,
    proof_status: input.method === 'cash' ? 'not_required' : 'approved',
    reviewed_by: input.method === 'cash' ? null : actorId,
    reviewed_at: input.method === 'cash' ? null : new Date().toISOString(),
    recorded_by: actorId,
    source: 'admin',
  })
  if (error) throw error
}

/** عكس دفعة: سطر مقابل + وسم الأصل — لا حذف أبداً */
export async function reversePayment(
  nurseryId: string,
  actorId: string | null,
  payment: PaymentRow,
): Promise<void> {
  const db = requireSupabase()
  const { data: reversal, error } = await db
    .from('payments')
    .insert({
      nursery_id: nurseryId,
      invoice_id: payment.invoice_id,
      child_id: payment.child_id,
      amount: payment.amount,
      method: payment.method,
      proof_status: 'not_required',
      reverses_id: payment.id,
      recorded_by: actorId,
      source: 'admin',
    })
    .select('id')
    .single()
  if (error) throw error
  const { error: markErr } = await db
    .from('payments')
    .update({ reversed_by_id: (reversal as { id: string }).id })
    .eq('id', payment.id)
  if (markErr) throw markErr
}

/** مدفوعات طفل (تبويب ملف الطفل — للمالك فقط بحكم RLS) */
export async function listChildPayments(childId: string): Promise<PaymentRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('payments')
    .select('*')
    .eq('child_id', childId)
    .order('paid_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PaymentRow[]
}

/** قايمة المتأخرات: أطفال بأرصدة موجبة على فواتير صادرة */
export interface OverdueItem {
  childId: string
  childName: string
  balance: number
  guardianName: string | null
  guardianPhone: string | null
  oldestPeriod: string
}

export async function listOverdue(nurseryId: string): Promise<OverdueItem[]> {
  const db = requireSupabase()
  const [balRes, childrenRes, linksRes, guardiansRes, invRes] = await Promise.all([
    db.from('child_balances').select('*').eq('nursery_id', nurseryId).gt('balance', 0),
    db.from('children').select('id, full_name').eq('nursery_id', nurseryId),
    db.from('guardian_children').select('child_id, guardian_id').eq('is_payer', true),
    db.from('guardians').select('id, full_name, phone').eq('nursery_id', nurseryId),
    db
      .from('invoice_balances')
      .select('child_id, period, balance')
      .eq('nursery_id', nurseryId)
      .eq('status', 'issued')
      .gt('balance', 0)
      .order('period'),
  ])
  if (balRes.error) throw balRes.error
  if (childrenRes.error) throw childrenRes.error
  if (linksRes.error) throw linksRes.error
  if (guardiansRes.error) throw guardiansRes.error
  if (invRes.error) throw invRes.error
  const names = new Map(
    (childrenRes.data ?? []).map((c) => [c.id as string, c.full_name as string]),
  )
  const payerByChild = new Map(
    (linksRes.data ?? []).map((l) => [l.child_id as string, l.guardian_id as string]),
  )
  const guardianById = new Map(
    (guardiansRes.data ?? []).map((g) => [
      g.id as string,
      g as unknown as { full_name: string; phone: string },
    ]),
  )
  const oldest = new Map<string, string>()
  for (const inv of invRes.data ?? []) {
    const cid = inv.child_id as string
    if (!oldest.has(cid)) oldest.set(cid, inv.period as string)
  }
  return ((balRes.data ?? []) as { child_id: string; balance: number }[])
    .map((b) => {
      const guardian = guardianById.get(payerByChild.get(b.child_id) ?? '')
      return {
        childId: b.child_id,
        childName: names.get(b.child_id) ?? '',
        balance: Number(b.balance),
        guardianName: guardian?.full_name ?? null,
        guardianPhone: guardian?.phone ?? null,
        oldestPeriod: oldest.get(b.child_id) ?? '',
      }
    })
    .sort((a, b) => b.balance - a.balance)
}
