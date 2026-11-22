import { requireSupabase } from '../../lib/supabase'
import { normalizeEgyptianPhone } from '../../lib/phone'

/** تطبيع موبايل مصري لصيغة التخزين — سقوط آمن للنص المقصوص عند التعذر */
function normalizePhone(raw: string): string {
  return normalizeEgyptianPhone(raw) ?? raw.trim()
}
import type {
  ChildHealthProfileRow,
  ChildRow,
  ClassRow,
  EnrollmentRow,
  GuardianRow,
  MedicationScheduleRow,
  PickupPersonRow,
} from '../../types/database'

export const CHILD_COLS =
  'id, nursery_id, full_name, birth_date, gender, photo_url, public_code, photo_consent, notes, archived_at, created_at, updated_at'
export const CLASS_COLS =
  'id, nursery_id, name, monthly_fee, capacity, age_from, age_to, nap_enabled, sort_order, archived_at, created_at, updated_at'

export interface ChildListItem extends ChildRow {
  className: string | null
  classId: string | null
  balance: number
}

/** قائمة الأطفال النشطين (تسجيل نشط) + فصل كل طفل + رصيده (للمالك من الـ view) */
export async function listChildren(nurseryId: string): Promise<ChildListItem[]> {
  const db = requireSupabase()
  const [childrenRes, enrollRes, classesRes, balancesRes] = await Promise.all([
    db
      .from('children')
      .select(CHILD_COLS)
      .eq('nursery_id', nurseryId)
      .is('archived_at', null)
      .order('full_name'),
    db
      .from('enrollments')
      .select('child_id, class_id')
      .eq('nursery_id', nurseryId)
      .eq('status', 'active'),
    db.from('classes').select('id, name').eq('nursery_id', nurseryId),
    db.from('child_balances').select('child_id, balance').eq('nursery_id', nurseryId),
  ])
  if (childrenRes.error) throw childrenRes.error
  if (enrollRes.error) throw enrollRes.error
  if (classesRes.error) throw classesRes.error
  // أرصدة الأطفال للمالك فقط (RLS) — للمشرفات ترجع فارغة بلا خطأ فنعرض 0
  const className = new Map(
    (classesRes.data ?? []).map((c) => [c.id as string, c.name as string]),
  )
  const enrollByChild = new Map(
    (enrollRes.data ?? []).map((e) => [e.child_id as string, e.class_id as string]),
  )
  const balanceByChild = new Map(
    (balancesRes.data ?? []).map((b) => [b.child_id as string, Number(b.balance)]),
  )
  return ((childrenRes.data ?? []) as ChildRow[]).map((child) => {
    const classId = enrollByChild.get(child.id) ?? null
    return {
      ...child,
      classId,
      className: classId ? (className.get(classId) ?? null) : null,
      balance: balanceByChild.get(child.id) ?? 0,
    }
  })
}

export interface ChildBundle {
  child: ChildRow
  enrollment: EnrollmentRow | null
  classRow: ClassRow | null
  guardians: (GuardianRow & { is_payer: boolean })[]
  pickupPersons: PickupPersonRow[]
  health: ChildHealthProfileRow | null
  medications: MedicationScheduleRow[]
}

export async function getChildBundle(
  nurseryId: string,
  childId: string,
): Promise<ChildBundle> {
  const db = requireSupabase()
  const { data: child, error } = await db
    .from('children')
    .select(CHILD_COLS)
    .eq('nursery_id', nurseryId)
    .eq('id', childId)
    .single()
  if (error) throw error

  const [enrollRes, linksRes, pickupRes, healthRes, medsRes] = await Promise.all([
    db
      .from('enrollments')
      .select('*')
      .eq('child_id', childId)
      .eq('status', 'active')
      .maybeSingle(),
    db
      .from('guardian_children')
      .select('is_payer, guardian:guardians(*)')
      .eq('child_id', childId),
    db
      .from('pickup_persons')
      .select('*')
      .eq('child_id', childId)
      .order('created_at'),
    db.from('child_health_profiles').select('*').eq('child_id', childId).maybeSingle(),
    db
      .from('medication_schedules')
      .select('*')
      .eq('child_id', childId)
      .order('created_at'),
  ])
  if (enrollRes.error) throw enrollRes.error
  if (linksRes.error) throw linksRes.error
  if (pickupRes.error) throw pickupRes.error
  if (healthRes.error) throw healthRes.error
  if (medsRes.error) throw medsRes.error

  const enrollment = (enrollRes.data as EnrollmentRow | null) ?? null
  let classRow: ClassRow | null = null
  if (enrollment) {
    const { data } = await db
      .from('classes')
      .select(CLASS_COLS)
      .eq('id', enrollment.class_id)
      .maybeSingle()
    classRow = (data as ClassRow | null) ?? null
  }

  const guardians = (linksRes.data ?? []).map((row) => {
    const g = row as unknown as { is_payer: boolean; guardian: GuardianRow }
    return { ...g.guardian, is_payer: g.is_payer }
  })

  return {
    child: child as ChildRow,
    enrollment,
    classRow,
    guardians,
    pickupPersons: (pickupRes.data ?? []) as PickupPersonRow[],
    health: (healthRes.data as ChildHealthProfileRow | null) ?? null,
    medications: (medsRes.data ?? []) as MedicationScheduleRow[],
  }
}

export interface ChildInput {
  full_name: string
  birth_date: string | null
  gender: 'male' | 'female' | null
  photo_consent: boolean
  notes: string | null
  class_id: string | null
  guardian_name: string
  guardian_phone: string
  guardian_relation: string | null
}

/** إنشاء طفل + وصيّه (upsert بالموبايل) + ربط + تسجيل في الفصل — قرار ق٤ */
export async function createChild(
  nurseryId: string,
  input: ChildInput,
): Promise<string> {
  const db = requireSupabase()
  const { data: child, error } = await db
    .from('children')
    .insert({
      nursery_id: nurseryId,
      full_name: input.full_name.trim(),
      birth_date: input.birth_date,
      gender: input.gender,
      photo_consent: input.photo_consent,
      notes: input.notes,
    })
    .select('id')
    .single()
  if (error) throw error
  const childId = (child as { id: string }).id

  const phone = normalizePhone(input.guardian_phone)
  const { data: guardian, error: gErr } = await db
    .from('guardians')
    .upsert(
      {
        nursery_id: nurseryId,
        phone,
        full_name: input.guardian_name.trim(),
        relation: input.guardian_relation,
      },
      { onConflict: 'nursery_id,phone' },
    )
    .select('id')
    .single()
  if (gErr) throw gErr
  const guardianId = (guardian as { id: string }).id

  const { error: linkErr } = await db.from('guardian_children').insert({
    guardian_id: guardianId,
    child_id: childId,
    is_payer: true,
  })
  if (linkErr) throw linkErr

  if (input.class_id) {
    const { error: eErr } = await db.from('enrollments').insert({
      nursery_id: nurseryId,
      child_id: childId,
      class_id: input.class_id,
    })
    if (eErr) throw eErr
  }
  return childId
}

export async function updateChild(
  nurseryId: string,
  childId: string,
  patch: Partial<
    Pick<
      ChildRow,
      'full_name' | 'birth_date' | 'gender' | 'photo_consent' | 'notes' | 'photo_url'
    >
  >,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('children')
    .update(patch)
    .eq('nursery_id', nurseryId)
    .eq('id', childId)
  if (error) throw error
}

export async function archiveChild(nurseryId: string, childId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('children')
    .update({ archived_at: new Date().toISOString() })
    .eq('nursery_id', nurseryId)
    .eq('id', childId)
  if (error) throw error
}

/** نقل طفل لفصل: إنهاء التسجيل النشط + تسجيل جديد */
export async function moveChildClass(
  nurseryId: string,
  childId: string,
  classId: string | null,
): Promise<void> {
  const db = requireSupabase()
  const { error: endErr } = await db
    .from('enrollments')
    .update({ status: 'left', ends_on: new Date().toISOString().slice(0, 10) })
    .eq('child_id', childId)
    .eq('status', 'active')
  if (endErr) throw endErr
  if (classId) {
    const { error } = await db.from('enrollments').insert({
      nursery_id: nurseryId,
      child_id: childId,
      class_id: classId,
    })
    if (error) throw error
  }
}

export async function addGuardian(
  nurseryId: string,
  childId: string,
  input: { full_name: string; phone: string; relation: string | null; is_payer: boolean },
): Promise<void> {
  const db = requireSupabase()
  const phone = normalizePhone(input.phone)
  const { data: guardian, error } = await db
    .from('guardians')
    .upsert(
      { nursery_id: nurseryId, phone, full_name: input.full_name.trim(), relation: input.relation },
      { onConflict: 'nursery_id,phone' },
    )
    .select('id')
    .single()
  if (error) throw error
  const { error: linkErr } = await db.from('guardian_children').upsert(
    {
      guardian_id: (guardian as { id: string }).id,
      child_id: childId,
      is_payer: input.is_payer,
    },
    { onConflict: 'guardian_id,child_id' },
  )
  if (linkErr) throw linkErr
}

export async function removeGuardianLink(
  guardianId: string,
  childId: string,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('guardian_children')
    .delete()
    .eq('guardian_id', guardianId)
    .eq('child_id', childId)
  if (error) throw error
}

export async function savePickupPerson(
  nurseryId: string,
  childId: string,
  input: {
    id?: string
    full_name: string
    relation: PickupPersonRow['relation']
    phone: string | null
  },
): Promise<void> {
  const db = requireSupabase()
  if (input.id) {
    const { error } = await db
      .from('pickup_persons')
      .update({ full_name: input.full_name, relation: input.relation, phone: input.phone })
      .eq('id', input.id)
    if (error) throw error
  } else {
    const { error } = await db.from('pickup_persons').insert({
      nursery_id: nurseryId,
      child_id: childId,
      full_name: input.full_name.trim(),
      relation: input.relation,
      phone: input.phone,
    })
    if (error) throw error
  }
}

export async function deletePickupPerson(id: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('pickup_persons').delete().eq('id', id)
  if (error) throw error
}

export async function saveHealthProfile(
  nurseryId: string,
  childId: string,
  profile: Omit<ChildHealthProfileRow, 'child_id' | 'nursery_id' | 'created_at' | 'updated_at'>,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('child_health_profiles').upsert(
    { nursery_id: nurseryId, child_id: childId, ...profile },
    { onConflict: 'child_id' },
  )
  if (error) throw error
}

export async function saveMedication(
  nurseryId: string,
  childId: string,
  input: {
    id?: string
    medicine: string
    dose: string
    times: string[]
    guardian_note: string | null
  },
): Promise<void> {
  const db = requireSupabase()
  if (input.id) {
    const { error } = await db
      .from('medication_schedules')
      .update({
        medicine: input.medicine,
        dose: input.dose,
        times: input.times,
        guardian_note: input.guardian_note,
      })
      .eq('id', input.id)
    if (error) throw error
  } else {
    const { error } = await db.from('medication_schedules').insert({
      nursery_id: nurseryId,
      child_id: childId,
      medicine: input.medicine.trim(),
      dose: input.dose.trim(),
      times: input.times,
      guardian_note: input.guardian_note,
    })
    if (error) throw error
  }
}

export async function deleteMedication(id: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('medication_schedules').delete().eq('id', id)
  if (error) throw error
}
