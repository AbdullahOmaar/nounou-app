import { requireSupabase } from '../../lib/supabase'
import type { PaymentRow } from '../../types/database'

export interface ProofItem extends PaymentRow {
  childName: string
  guardianName: string | null
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
  const [childrenRes, guardiansRes] = await Promise.all([
    db.from('children').select('id, full_name').in('id', childIds),
    guardianIds.length
      ? db.from('guardians').select('id, full_name').in('id', guardianIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (childrenRes.error) throw childrenRes.error
  if (guardiansRes.error) throw guardiansRes.error
  const childNames = new Map(
    (childrenRes.data ?? []).map((c) => [c.id as string, c.full_name as string]),
  )
  const guardianNames = new Map(
    (guardiansRes.data ?? []).map((g) => [g.id as string, g.full_name as string]),
  )
  return payments.map((p) => ({
    ...p,
    childName: childNames.get(p.child_id) ?? '',
    guardianName: p.guardian_id ? (guardianNames.get(p.guardian_id) ?? null) : null,
  }))
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
 * للطفل إن وُجدت، وتأخذ رقم إيصال ذرّياً، وتدخل الأرصدة فوراً (الـ view
 * يحتسب approved). الرفض بسبب ظاهر لولي الأمر في بوابته.
 */
export async function approveProof(
  nurseryId: string,
  actorId: string | null,
  proof: PaymentRow,
): Promise<void> {
  const db = requireSupabase()
  const { data: receiptNo, error: rErr } = await db.rpc('next_receipt_no', {
    p_nursery: nurseryId,
  })
  if (rErr) throw rErr

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
      receipt_no: receiptNo as number,
      invoice_id: invoiceId,
    })
    .eq('id', proof.id)
    .eq('proof_status', 'pending')
  if (error) throw error
}

export async function rejectProof(
  actorId: string | null,
  proofId: string,
  reason: string,
): Promise<void> {
  const db = requireSupabase()
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
}
