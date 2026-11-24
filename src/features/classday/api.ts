import { requireSupabase } from '../../lib/supabase'
import type {
  AttendanceRow,
  AttendanceStatus,
  ChildRow,
  ClassDayRow,
  PickupPersonRow,
} from '../../types/database'

export async function getOrCreateClassDay(
  nurseryId: string,
  classId: string,
  date: string,
): Promise<ClassDayRow> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('class_days')
    .upsert(
      { nursery_id: nurseryId, class_id: classId, day_date: date },
      { onConflict: 'class_id,day_date' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data as ClassDayRow
}

export async function setClassDayStatus(
  dayId: string,
  status: 'open' | 'closed',
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('class_days').update({ status }).eq('id', dayId)
  if (error) throw error
}

export interface DayChild {
  child: ChildRow
  attendance: AttendanceRow | null
  pickupPersons: PickupPersonRow[]
  guardians: { id: string; full_name: string }[]
}

/** أطفال الفصل المسجلون + حالة يومهم + قوائم استلامهم */
export async function listDayChildren(
  nurseryId: string,
  classId: string,
  classDayId: string,
): Promise<DayChild[]> {
  const db = requireSupabase()
  const [enrollRes, attRes] = await Promise.all([
    db
      .from('enrollments')
      .select('child:children(*)')
      .eq('nursery_id', nurseryId)
      .eq('class_id', classId)
      .eq('status', 'active'),
    db.from('attendance').select('*').eq('class_day_id', classDayId),
  ])
  if (enrollRes.error) throw enrollRes.error
  if (attRes.error) throw attRes.error
  const children = (enrollRes.data ?? [])
    .map((e) => (e as unknown as { child: ChildRow }).child)
    .filter((c) => c && !c.archived_at)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
  const attByChild = new Map(
    ((attRes.data ?? []) as AttendanceRow[]).map((a) => [a.child_id, a]),
  )
  let pickupByChild = new Map<string, PickupPersonRow[]>()
  let guardiansByChild = new Map<string, { id: string; full_name: string }[]>()
  if (children.length > 0) {
    const { data, error } = await db
      .from('pickup_persons')
      .select('*')
      .in('child_id', children.map((c) => c.id))
      .eq('is_active', true)
    if (error) throw error
    pickupByChild = new Map()
    for (const p of (data ?? []) as PickupPersonRow[]) {
      const arr = pickupByChild.get(p.child_id) ?? []
      arr.push(p)
      pickupByChild.set(p.child_id, arr)
    }
    const { data: links, error: linkErr } = await db
      .from('guardian_children')
      .select('child_id, guardian:guardians(id, full_name)')
      .in('child_id', children.map((c) => c.id))
    if (linkErr) throw linkErr
    guardiansByChild = new Map()
    for (const l of links ?? []) {
      const row = l as unknown as {
        child_id: string
        guardian: { id: string; full_name: string } | null
      }
      if (!row.guardian) continue
      const arr = guardiansByChild.get(row.child_id) ?? []
      arr.push(row.guardian)
      guardiansByChild.set(row.child_id, arr)
    }
  }
  return children.map((child) => ({
    child,
    attendance: attByChild.get(child.id) ?? null,
    pickupPersons: pickupByChild.get(child.id) ?? [],
    guardians: guardiansByChild.get(child.id) ?? [],
  }))
}

export interface AttendanceUpsert {
  nursery_id: string
  class_day_id: string
  child_id: string
  status: AttendanceStatus
  arrived_at?: string | null
  arrived_by?: string | null
  arrival_method?: 'manual' | 'qr' | null
  picked_up_at?: string | null
  picked_up_by?: string | null
  picked_up_guardian?: boolean
  picked_up_guardian_id?: string | null
  handed_by?: string | null
  pickup_code_used?: boolean
  note?: string | null
}

/** كتابة حدث حضور/استلام (upsert على الطفل × اليوم) — تُستخدم أوفلاين أيضاً */
export async function upsertAttendance(payload: AttendanceUpsert): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('attendance')
    .upsert(payload, { onConflict: 'class_day_id,child_id' })
  if (error) throw error
}

export async function findChildByCode(
  nurseryId: string,
  code: string,
): Promise<ChildRow | null> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('children')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('public_code', code.toUpperCase())
    .is('archived_at', null)
    .maybeSingle()
  if (error) throw error
  return (data as ChildRow | null) ?? null
}

/** سجل حضور طفل (تبويب ملف الطفل) */
export interface ChildAttendanceItem {
  day_date: string
  status: AttendanceStatus
  arrived_at: string | null
  picked_up_at: string | null
}

export async function listChildAttendance(
  childId: string,
  limit = 30,
): Promise<ChildAttendanceItem[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('attendance')
    .select('status, arrived_at, picked_up_at, day:class_days(day_date)')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      status: AttendanceStatus
      arrived_at: string | null
      picked_up_at: string | null
      day: { day_date: string } | null
    }
    return {
      day_date: r.day?.day_date ?? '',
      status: r.status,
      arrived_at: r.arrived_at,
      picked_up_at: r.picked_up_at,
    }
  })
}

/**
 * 420-U2: تحقق خادمي من كود الاستلام (RPC ‏verify_pickup_code — هجرة 0021).
 * الكود يُعلَّم مستخدماً ذرّياً والمحاولات الخاطئة تُسجَّل في سجل النشاط.
 * لا يرمي: أي فشل شبكة/خادم = رفض مغلق (reason 'error').
 */
export async function verifyPickupCode(
  nurseryId: string,
  childId: string,
  date: string,
  code: string,
): Promise<{ ok: boolean; reason?: string }> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('verify_pickup_code', {
    p_nursery_id: nurseryId,
    p_child_id: childId,
    p_day_date: date,
    p_code: code,
  })
  if (error) return { ok: false, reason: 'error' }
  const verdict = data as { ok?: boolean; reason?: string } | null
  return { ok: verdict?.ok === true, reason: verdict?.reason }
}

/** أكواد الاستلام اليومية لأطفال (عند تفعيل الإعداد) */
export async function ensurePickupCodes(
  nurseryId: string,
  childIds: string[],
  date: string,
): Promise<Map<string, string>> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('pickup_codes')
    .select('child_id, code')
    .eq('nursery_id', nurseryId)
    .eq('day_date', date)
    .in('child_id', childIds)
  if (error) throw error
  const map = new Map((data ?? []).map((r) => [r.child_id as string, r.code as string]))
  const missing = childIds.filter((id) => !map.has(id))
  for (const childId of missing) {
    // توليد تشفيري (420-U2) — Math.random غير مقبول لأكواد استلام
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const code = String(100000 + (buf[0] % 900000))
    const { error: insErr } = await db.from('pickup_codes').insert({
      nursery_id: nurseryId,
      child_id: childId,
      day_date: date,
      code,
    })
    if (!insErr) map.set(childId, code)
  }
  return map
}
