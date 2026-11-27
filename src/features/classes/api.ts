import { requireSupabase } from '../../lib/supabase'
import type { ClassRow, NurseryMemberRow } from '../../types/database'
import { CLASS_COLS } from '../children/api'

export interface ClassListItem extends ClassRow {
  childrenCount: number
}

export async function listClasses(nurseryId: string): Promise<ClassListItem[]> {
  const db = requireSupabase()
  const [classesRes, enrollRes] = await Promise.all([
    db
      .from('classes')
      .select(CLASS_COLS)
      .eq('nursery_id', nurseryId)
      .is('archived_at', null)
      .order('sort_order')
      .order('name'),
    db
      .from('enrollments')
      .select('class_id')
      .eq('nursery_id', nurseryId)
      .eq('status', 'active'),
  ])
  if (classesRes.error) throw classesRes.error
  if (enrollRes.error) throw enrollRes.error
  const counts = new Map<string, number>()
  for (const e of enrollRes.data ?? []) {
    const id = e.class_id as string
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return ((classesRes.data ?? []) as ClassRow[]).map((c) => ({
    ...c,
    childrenCount: counts.get(c.id) ?? 0,
  }))
}

export interface ClassInput {
  name: string
  monthly_fee: number
  capacity: number | null
  age_from: number | null
  age_to: number | null
  nap_enabled: boolean
}

export async function createClass(
  nurseryId: string,
  input: ClassInput,
): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('classes')
    .insert({ nursery_id: nurseryId, ...input, name: input.name.trim() })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateClass(
  classId: string,
  patch: Partial<ClassInput>,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('classes').update(patch).eq('id', classId)
  if (error) throw error
}

export async function archiveClass(classId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('classes')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', classId)
  if (error) throw error
}

export interface ClassStaffItem {
  member_id: string
  display_name: string
  role: string
}

/** طاقم الحضانة + مين مربوط بالفصل ده */
export async function listClassStaff(
  nurseryId: string,
  classId: string,
): Promise<{ all: (NurseryMemberRow & { display_name: string })[]; assigned: Set<string> }> {
  const db = requireSupabase()
  const [membersRes, staffRes, usersRes] = await Promise.all([
    db
      .from('nursery_members')
      .select('*')
      .eq('nursery_id', nurseryId)
      .eq('status', 'active'),
    db.from('class_staff').select('member_id').eq('class_id', classId),
    db.from('users').select('id, display_name'),
  ])
  if (membersRes.error) throw membersRes.error
  if (staffRes.error) throw staffRes.error
  if (usersRes.error) throw usersRes.error
  const names = new Map(
    (usersRes.data ?? []).map((u) => [u.id as string, u.display_name as string]),
  )
  const all = ((membersRes.data ?? []) as NurseryMemberRow[]).map((m) => ({
    ...m,
    display_name: m.user_id ? (names.get(m.user_id) ?? '') : (m.invited_email ?? ''),
  }))
  const assigned = new Set((staffRes.data ?? []).map((s) => s.member_id as string))
  return { all, assigned }
}

export interface ClassTodayStatus {
  opened: boolean
  present: number
  absent: number
}

/**
 * حالة اليوم لكل فصل (قراءة فقط — موجة الهوية 2): أي فصل اتفتح
 * (صف class_days موجود) وعدّادات حضوره، من نفس جداول الحضور الحية.
 */
export async function listClassesToday(
  nurseryId: string,
  date: string,
): Promise<Map<string, ClassTodayStatus>> {
  const db = requireSupabase()
  const daysRes = await db
    .from('class_days')
    .select('id, class_id')
    .eq('nursery_id', nurseryId)
    .eq('day_date', date)
  if (daysRes.error) throw daysRes.error
  const days = (daysRes.data ?? []) as { id: string; class_id: string }[]
  const out = new Map<string, ClassTodayStatus>()
  const classByDay = new Map<string, string>()
  for (const d of days) {
    classByDay.set(d.id, d.class_id)
    out.set(d.class_id, { opened: true, present: 0, absent: 0 })
  }
  if (days.length === 0) return out
  const attRes = await db
    .from('attendance')
    .select('class_day_id, status')
    .in('class_day_id', days.map((d) => d.id))
  if (attRes.error) throw attRes.error
  for (const a of (attRes.data ?? []) as { class_day_id: string; status: string }[]) {
    const classId = classByDay.get(a.class_day_id)
    if (!classId) continue
    const entry = out.get(classId)!
    if (a.status === 'present') entry.present++
    else if (a.status === 'absent') entry.absent++
  }
  return out
}

/**
 * أسماء طاقم كل فصل (قراءة فقط — موجة الهوية 2): أسماء العرض
 * للمشرفات المرتبطات بكل فصل عبر class_staff.
 */
export async function listClassesStaffNames(
  nurseryId: string,
  classIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (classIds.length === 0) return out
  const db = requireSupabase()
  const [staffRes, membersRes, usersRes] = await Promise.all([
    db.from('class_staff').select('class_id, member_id').in('class_id', classIds),
    db
      .from('nursery_members')
      .select('id, user_id, invited_email')
      .eq('nursery_id', nurseryId)
      .eq('status', 'active'),
    db.from('users').select('id, display_name'),
  ])
  if (staffRes.error) throw staffRes.error
  if (membersRes.error) throw membersRes.error
  if (usersRes.error) throw usersRes.error
  const nameByUser = new Map(
    (usersRes.data ?? []).map((u) => [u.id as string, u.display_name as string]),
  )
  const nameByMember = new Map(
    ((membersRes.data ?? []) as { id: string; user_id: string | null; invited_email: string | null }[]).map(
      (m) => [m.id, m.user_id ? (nameByUser.get(m.user_id) ?? '') : (m.invited_email ?? '')],
    ),
  )
  for (const s of (staffRes.data ?? []) as { class_id: string; member_id: string }[]) {
    const name = nameByMember.get(s.member_id)
    if (!name) continue
    const list = out.get(s.class_id) ?? []
    list.push(name)
    out.set(s.class_id, list)
  }
  return out
}

export async function setClassStaff(
  classId: string,
  memberId: string,
  assigned: boolean,
): Promise<void> {
  const db = requireSupabase()
  if (assigned) {
    const { error } = await db
      .from('class_staff')
      .insert({ class_id: classId, member_id: memberId })
    if (error) throw error
  } else {
    const { error } = await db
      .from('class_staff')
      .delete()
      .eq('class_id', classId)
      .eq('member_id', memberId)
    if (error) throw error
  }
}
