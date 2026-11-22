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
