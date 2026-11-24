import { requireSupabase } from '../../lib/supabase'
import { logActivity } from '../settings/api'

export interface FeeReminderRun {
  attempted: number
  skippedRecent: number
  byStatus: Record<string, number>
}

interface Candidate {
  guardianId: string
  total: number
  children: number
}

/**
 * محرك تذكيرات الرسوم (2.3): تجميع المتأخرات لكل وصيّ دافع، ومنع
 * التكرار خلال 7 أيام (من سجل الإرسال نفسه)، ثم المرور ببوابات
 * واتساب (2.2) — كل محاولة تُسجَّل بحالتها. لا إرسال فعلي ما دامت
 * البوابات مغلقة؛ وعند فتحها تصبح نفس المحاولات رسائل Utility.
 */
export async function runFeeReminders(
  nurseryId: string,
  actorId: string | null,
): Promise<FeeReminderRun> {
  const db = requireSupabase()
  const [balRes, linksRes] = await Promise.all([
    db
      .from('child_balances')
      .select('child_id, balance')
      .eq('nursery_id', nurseryId)
      .gt('balance', 0),
    db.from('guardian_children').select('child_id, guardian_id').eq('is_payer', true),
  ])
  if (balRes.error) throw balRes.error
  if (linksRes.error) throw linksRes.error
  const payerByChild = new Map(
    (linksRes.data ?? []).map((l) => [l.child_id as string, l.guardian_id as string]),
  )
  const byGuardian = new Map<string, Candidate>()
  for (const row of balRes.data ?? []) {
    const guardianId = payerByChild.get(row.child_id as string)
    if (!guardianId) continue
    const cur = byGuardian.get(guardianId) ?? { guardianId, total: 0, children: 0 }
    cur.total += Number(row.balance)
    cur.children += 1
    byGuardian.set(guardianId, cur)
  }
  const candidates = [...byGuardian.values()]
  if (candidates.length === 0) return { attempted: 0, skippedRecent: 0, byStatus: {} }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data: recent, error: rErr } = await db
    .from('whatsapp_send_log')
    .select('guardian_id')
    .eq('nursery_id', nurseryId)
    .eq('template', 'fee_reminder')
    .gte('created_at', since)
    .in('guardian_id', candidates.map((c) => c.guardianId))
  if (rErr) throw rErr
  const recentSet = new Set((recent ?? []).map((r) => r.guardian_id as string))

  const byStatus: Record<string, number> = {}
  let attempted = 0
  let skippedRecent = 0
  for (const c of candidates) {
    if (recentSet.has(c.guardianId)) {
      skippedRecent += 1
      continue
    }
    const { data, error } = await db.rpc('whatsapp_enqueue', {
      p_nursery: nurseryId,
      p_guardian: c.guardianId,
      p_template: 'fee_reminder',
      p_params: { amount: c.total, children: c.children },
    })
    if (error) throw error
    attempted += 1
    const status = data as string
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  await logActivity(
    nurseryId,
    actorId,
    'fee_reminders_run',
    `attempted ${attempted} — skipped ${skippedRecent}`,
  )
  return { attempted, skippedRecent, byStatus }
}
