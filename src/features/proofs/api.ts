import { requireSupabase } from '../../lib/supabase'
import type { PaymentRow } from '../../types/database'
import { logActivity } from '../settings/api'

export interface ProofItem extends PaymentRow {
  childName: string
  guardianName: string | null
  /** المتبقي الكلي على الطفل عبر فواتيره الصادرة — سياق قرار الاعتماد (3A-363) */
  childBalance: number
  /** فترة الفاتورة المرتبطة بهذا الإثبات إن وُجدت */
  invoicePeriod: string | null
  /** المتبقي على الفاتورة المرتبطة إن وُجدت */
  invoiceBalance: number | null
}

/** إثباتات البوابة المعلّقة (مؤكدة الرفع فقط — اليتيمة بلا صورة لا تظهر) */
export async function listPendingProofs(nurseryId: string): Promise<ProofItem[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('payments')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('proof_status', 'pending')
    .eq('source', 'portal')
    .not('proof_confirmed_at', 'is', null)
    .order('created_at')
  if (error) throw error
  const payments = (data ?? []) as PaymentRow[]
  if (payments.length === 0) return []
  const childIds = [...new Set(payments.map((p) => p.child_id))]
  const guardianIds = [...new Set(payments.map((p) => p.guardian_id).filter(Boolean))] as string[]
  const invoiceIds = [...new Set(payments.map((p) => p.invoice_id).filter(Boolean))] as string[]
  const [childrenRes, guardiansRes, childBalancesRes, invoiceBalancesRes] = await Promise.all([
    db.from('children').select('id, full_name').in('id', childIds),
    guardianIds.length
      ? db.from('guardians').select('id, full_name').in('id', guardianIds)
      : Promise.resolve({ data: [], error: null }),
    db.from('child_balances').select('child_id, balance').in('child_id', childIds),
    invoiceIds.length
      ? db
          .from('invoice_balances')
          .select('invoice_id, period, balance')
          .in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (childrenRes.error) throw childrenRes.error
  if (guardiansRes.error) throw guardiansRes.error
  if (childBalancesRes.error) throw childBalancesRes.error
  if (invoiceBalancesRes.error) throw invoiceBalancesRes.error
  const childNames = new Map(
    (childrenRes.data ?? []).map((c) => [c.id as string, c.full_name as string]),
  )
  const guardianNames = new Map(
    (guardiansRes.data ?? []).map((g) => [g.id as string, g.full_name as string]),
  )
  const childBalances = new Map(
    (childBalancesRes.data ?? []).map((b) => [b.child_id as string, Number(b.balance)]),
  )
  const invoiceBalances = new Map(
    (invoiceBalancesRes.data ?? []).map((b) => [
      b.invoice_id as string,
      { period: b.period as string, balance: Number(b.balance) },
    ]),
  )
  return payments.map((p) => {
    const inv = p.invoice_id ? invoiceBalances.get(p.invoice_id) : undefined
    return {
      ...p,
      childName: childNames.get(p.child_id) ?? '',
      guardianName: p.guardian_id ? (guardianNames.get(p.guardian_id) ?? null) : null,
      childBalance: childBalances.get(p.child_id) ?? 0,
      invoicePeriod: inv?.period ?? null,
      invoiceBalance: inv?.balance ?? null,
    }
  })
}

/** رابط موقع قصير لصورة الإثبات (قراءة المالك عبر سياسة التخزين) */
export async function proofSignedUrl(path: string): Promise<string | null> {
  const db = requireSupabase()
  const { data, error } = await db.storage
    .from('payment-proofs')
    .createSignedUrl(path, 600)
  if (error) return null
  return data.signedUrl
}

/**
 * اعتماد إثبات: يتحول لدفعة حقيقية — تُربط بأقدم فاتورة صادرة مفتوحة
 * للطفل إن وُجدت، وتدخل الأرصدة فوراً (الـ view يحتسب approved).
 * رقم الإيصال أُسند أصلاً عند إدراج الدفعة عبر مشغّل القاعدة (هجرة
 * 0013) فلا يُلمس هنا. الرفض بسبب ظاهر لولي الأمر في بوابته.
 */
export async function approveProofInternal(
  actorId: string | null,
  proof: PaymentRow,
): Promise<void> {
  const db = requireSupabase()
  let invoiceId = proof.invoice_id
  if (!invoiceId) {
    const { data: open } = await db
      .from('invoice_balances')
      .select('invoice_id, balance')
      .eq('child_id', proof.child_id)
      .eq('status', 'issued')
      .gt('balance', 0)
      .order('period')
      .limit(1)
    invoiceId = (open?.[0]?.invoice_id as string | undefined) ?? null
  }

  const { error } = await db
    .from('payments')
    .update({
      proof_status: 'approved',
      reviewed_by: actorId,
      reviewed_at: new Date().toISOString(),
      invoice_id: invoiceId,
    })
    .eq('id', proof.id)
    .eq('proof_status', 'pending')
  if (error) throw error
  await logActivity(
    proof.nursery_id,
    actorId,
    'proof_approved',
    `${proof.amount} — ${proof.method}`,
    'payment',
    proof.id,
  )
}

export async function rejectProof(
  actorId: string | null,
  proofId: string,
  reason: string,
): Promise<void> {
  const db = requireSupabase()
  const { data: pay } = await db
    .from('payments')
    .select('nursery_id, amount, method')
    .eq('id', proofId)
    .maybeSingle()
  const { error } = await db
    .from('payments')
    .update({
      proof_status: 'rejected',
      reviewed_by: actorId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', proofId)
    .eq('proof_status', 'pending')
  if (error) throw error
  const p = pay as { nursery_id: string; amount: number; method: string } | null
  if (p) {
    await logActivity(
      p.nursery_id,
      actorId,
      'proof_rejected',
      `${p.amount} — ${p.method}: ${reason}`,
      'payment',
      proofId,
    )
  }
}

/**
 * بوابة الاعتماد الثاني (1.5): اعتماد إثبات فوق الحد لا يُنفَّذ —
 * يُحفظ طلباً معلّقاً (ولا يتكرر إن وُجد طلب معلّق لنفس الدفعة).
 */
export async function approveProof(
  actorId: string | null,
  proof: PaymentRow,
): Promise<'done' | 'pending'> {
  const { PROOF_APPROVAL_LIMIT, requestApproval } = await import(
    '../approvals/api'
  )
  if (Number(proof.amount) > PROOF_APPROVAL_LIMIT) {
    const db = requireSupabase()
    const { data } = await db
      .from('pending_approvals')
      .select('id')
      .eq('nursery_id', proof.nursery_id)
      .eq('action_kind', 'proof_approve')
      .eq('status', 'pending')
      .filter('payload->>paymentId', 'eq', proof.id)
      .limit(1)
    if (!data || data.length === 0) {
      await requestApproval(
        proof.nursery_id,
        actorId,
        'proof_approve',
        { paymentId: proof.id },
        `proof — ${proof.amount}`,
      )
    }
    return 'pending'
  }
  await approveProofInternal(actorId, proof)
  return 'done'
}
