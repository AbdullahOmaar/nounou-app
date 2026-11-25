import { requireSupabase } from '../../lib/supabase'
import { runFeeReminders } from '../invoices/reminders'

/**
 * كتالوج أفعال المساعد المشرف (4.8): قائمة مغلقة — المساعد
 * لا ينفذ إلا فعلاً مسجلاً هنا، وكل فعل كتابة يتطلب تأكيداً
 * صريحاً قبل التنفيذ، وقابلاً للإيقاف منتصف الطلب (4.9)،
 * وكل تنفيذ يُسجل في سجل النشاط. طبقة الفهم اللغوي (مزود
 * ذكاء) تُربط فوق هذا الكتالوج نفسه عند قرار المزود —
 * العقد في docs/ASSISTANT.md.
 */
export type AssistantActionId = 'fee_reminders' | 'day_summary'

export interface DaySummary {
  children: number
  outstanding: number
  pendingProofs: number
}

export async function fetchDaySummary(
  nurseryId: string,
): Promise<DaySummary> {
  const db = requireSupabase()
  const [balRes, proofRes, childRes] = await Promise.all([
    db
      .from('child_balances')
      .select('balance')
      .eq('nursery_id', nurseryId)
      .gt('balance', 0),
    db
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('nursery_id', nurseryId)
      .eq('proof_status', 'pending'),
    db
      .from('children')
      .select('id', { count: 'exact', head: true })
      .eq('nursery_id', nurseryId)
      .is('archived_at', null),
  ])
  if (balRes.error) throw balRes.error
  if (proofRes.error) throw proofRes.error
  if (childRes.error) throw childRes.error
  const outstanding = (
    (balRes.data ?? []) as { balance: number | string }[]
  ).reduce((sum, r) => sum + Number(r.balance), 0)
  return {
    children: childRes.count ?? 0,
    outstanding,
    pendingProofs: proofRes.count ?? 0,
  }
}

export { runFeeReminders }
