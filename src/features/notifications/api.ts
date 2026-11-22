import { requireSupabase } from '../../lib/supabase'
import { todayISO } from '../../lib/format'

export type AlertKind =
  | 'notPickedUp'
  | 'proofsPending'
  | 'overdue'
  | 'reportsMissing'
  | 'absentStreak'

export interface AlertItem {
  kind: AlertKind
  count: number
  amount?: number
  childName?: string
}

/**
 * تنبيهات نونو — محسوبة من البيانات الحية (نمط المدرس): لا جدول تنبيهات
 * مخزّن، فلا حالة قديمة أبداً. المالية للمالك فقط (تُحسب له وحده لأن
 * RLS تمنع غيره من قراءة مصدرها أصلاً).
 */
export async function fetchAlerts(
  nurseryId: string,
  isOwner: boolean,
): Promise<AlertItem[]> {
  const db = requireSupabase()
  const today = todayISO()
  const alerts: AlertItem[] = []

  const [settingsRes, daysRes] = await Promise.all([
    db.from('nursery_settings').select('day_end_time').eq('nursery_id', nurseryId).single(),
    db.from('class_days').select('id').eq('nursery_id', nurseryId).eq('day_date', today),
  ])
  if (settingsRes.error) throw settingsRes.error
  if (daysRes.error) throw daysRes.error
  const dayIds = (daysRes.data ?? []).map((d) => d.id as string)
  const dayEnd = (settingsRes.data as { day_end_time: string }).day_end_time.slice(0, 5)
  const now = new Date()
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  if (dayIds.length > 0) {
    const { data: att, error } = await db
      .from('attendance')
      .select('child_id, status, picked_up_at')
      .in('class_day_id', dayIds)
    if (error) throw error
    const rows = (att ?? []) as {
      child_id: string
      status: string
      picked_up_at: string | null
    }[]
    const notPicked = rows.filter(
      (r) => r.status === 'present' && !r.picked_up_at,
    ).length
    if (notPicked > 0 && nowHM >= dayEnd) {
      alerts.push({ kind: 'notPickedUp', count: notPicked })
    }
    const presentIds = rows
      .filter((r) => r.status === 'present' || r.status === 'early_leave')
      .map((r) => r.child_id)
    if (presentIds.length > 0) {
      const { data: reports, error: repErr } = await db
        .from('daily_reports')
        .select('child_id, published_at')
        .in('class_day_id', dayIds)
      if (repErr) throw repErr
      const published = new Set(
        (reports ?? [])
          .filter((r) => r.published_at)
          .map((r) => r.child_id as string),
      )
      const missing = presentIds.filter((id) => !published.has(id)).length
      if (missing > 0) alerts.push({ kind: 'reportsMissing', count: missing })
    }
  }

  // غياب متكرر: ٣+ غيابات في آخر ١٤ يوم
  const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
  const { data: recentDays } = await db
    .from('class_days')
    .select('id')
    .eq('nursery_id', nurseryId)
    .gte('day_date', since)
  const recentIds = (recentDays ?? []).map((d) => d.id as string)
  if (recentIds.length > 0) {
    const { data: absences } = await db
      .from('attendance')
      .select('child_id')
      .in('class_day_id', recentIds)
      .eq('status', 'absent')
    const counts = new Map<string, number>()
    for (const a of absences ?? []) {
      const id = a.child_id as string
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    const streakers = [...counts.entries()].filter(([, n]) => n >= 3)
    if (streakers.length > 0) {
      const { data: child } = await db
        .from('children')
        .select('full_name')
        .eq('id', streakers[0][0])
        .single()
      alerts.push({
        kind: 'absentStreak',
        count: streakers[0][1],
        childName: (child as { full_name: string } | null)?.full_name,
      })
    }
  }

  if (isOwner) {
    const { count: proofCount } = await db
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('nursery_id', nurseryId)
      .eq('proof_status', 'pending')
      .eq('source', 'portal')
      .not('proof_confirmed_at', 'is', null)
    if (proofCount && proofCount > 0) {
      alerts.push({ kind: 'proofsPending', count: proofCount })
    }
    const { data: balances } = await db
      .from('child_balances')
      .select('balance')
      .eq('nursery_id', nurseryId)
      .gt('balance', 0)
    const overdueTotal = (balances ?? []).reduce(
      (s, b) => s + Number(b.balance ?? 0),
      0,
    )
    if (overdueTotal > 0) {
      alerts.push({ kind: 'overdue', count: (balances ?? []).length, amount: overdueTotal })
    }
  }

  return alerts
}
