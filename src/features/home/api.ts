import { requireSupabase } from '../../lib/supabase'
import { todayISO } from '../../lib/format'

export interface HomeSummary {
  childrenTotal: number
  staffTotal: number
  presentToday: number
  absentToday: number
  notPickedUp: number
  reportsMissing: number
  reportsUnpublished: number
  overdueTotal: number | null // null = ليس مالكاً (لا يرى المالية)
  pendingProofs: number | null
  classes: { id: string; name: string; present: number; total: number }[]
}

/** ملخص الرئيسية: عدّادات اليوم الحية + حالة كل فصل */
export async function fetchHomeSummary(
  nurseryId: string,
  isOwner: boolean,
): Promise<HomeSummary> {
  const db = requireSupabase()
  const today = todayISO()
  const [childrenRes, membersRes, classesRes, enrollRes, daysRes] = await Promise.all([
    db
      .from('children')
      .select('id', { count: 'exact', head: true })
      .eq('nursery_id', nurseryId)
      .is('archived_at', null),
    db
      .from('nursery_members')
      .select('id', { count: 'exact', head: true })
      .eq('nursery_id', nurseryId)
      .eq('status', 'active'),
    db
      .from('classes')
      .select('id, name')
      .eq('nursery_id', nurseryId)
      .is('archived_at', null)
      .order('sort_order'),
    db
      .from('enrollments')
      .select('class_id')
      .eq('nursery_id', nurseryId)
      .eq('status', 'active'),
    db.from('class_days').select('id, class_id').eq('nursery_id', nurseryId).eq('day_date', today),
  ])
  if (childrenRes.error) throw childrenRes.error
  if (membersRes.error) throw membersRes.error
  if (classesRes.error) throw classesRes.error
  if (enrollRes.error) throw enrollRes.error
  if (daysRes.error) throw daysRes.error

  const totalsByClass = new Map<string, number>()
  for (const e of enrollRes.data ?? []) {
    const id = e.class_id as string
    totalsByClass.set(id, (totalsByClass.get(id) ?? 0) + 1)
  }
  const dayIdByClass = new Map(
    (daysRes.data ?? []).map((d) => [d.class_id as string, d.id as string]),
  )
  const dayIds = [...dayIdByClass.values()]

  let present = 0
  let absent = 0
  let notPicked = 0
  let reportsMissing = 0
  let reportsUnpublished = 0
  const presentByClass = new Map<string, number>()

  if (dayIds.length > 0) {
    const { data: att, error } = await db
      .from('attendance')
      .select('class_day_id, status, picked_up_at, child_id')
      .in('class_day_id', dayIds)
    if (error) throw error
    const rows = (att ?? []) as {
      class_day_id: string
      status: string
      picked_up_at: string | null
      child_id: string
    }[]
    const classByDay = new Map(
      (daysRes.data ?? []).map((d) => [d.id as string, d.class_id as string]),
    )
    const presentChildIds: string[] = []
    for (const r of rows) {
      if (r.status === 'present' || r.status === 'early_leave') {
        present++
        presentChildIds.push(r.child_id)
        const cid = classByDay.get(r.class_day_id)
        if (cid) presentByClass.set(cid, (presentByClass.get(cid) ?? 0) + 1)
        if (!r.picked_up_at) notPicked++
      } else if (r.status === 'absent') {
        absent++
      }
    }
    if (presentChildIds.length > 0) {
      const { data: reports } = await db
        .from('daily_reports')
        .select('child_id, published_at')
        .in('class_day_id', dayIds)
      const published = new Set(
        (reports ?? []).filter((r) => r.published_at).map((r) => r.child_id as string),
      )
      reportsMissing = presentChildIds.filter((id) => !published.has(id)).length
      // 420-T3: مكتوبة بلا نشر (حاضرون فقط — نفس استثناء النشر الجماعي)
      const presentSet = new Set(presentChildIds)
      reportsUnpublished = (reports ?? []).filter(
        (r) => !r.published_at && presentSet.has(r.child_id as string),
      ).length
    }
  }

  let overdueTotal: number | null = null
  let pendingProofs: number | null = null
  if (isOwner) {
    const { data: balances } = await db
      .from('child_balances')
      .select('balance')
      .eq('nursery_id', nurseryId)
      .gt('balance', 0)
    overdueTotal = (balances ?? []).reduce((s, b) => s + Number(b.balance ?? 0), 0)
    const { count } = await db
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('nursery_id', nurseryId)
      .eq('proof_status', 'pending')
      .eq('source', 'portal')
      .not('proof_confirmed_at', 'is', null)
    pendingProofs = count ?? 0
  }

  return {
    childrenTotal: childrenRes.count ?? 0,
    staffTotal: membersRes.count ?? 0,
    presentToday: present,
    absentToday: absent,
    notPickedUp: notPicked,
    reportsMissing,
    reportsUnpublished,
    overdueTotal,
    pendingProofs,
    classes: (classesRes.data ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      present: presentByClass.get(c.id as string) ?? 0,
      total: totalsByClass.get(c.id as string) ?? 0,
    })),
  }
}
