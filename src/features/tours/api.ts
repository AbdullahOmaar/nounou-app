import { requireSupabase } from '../../lib/supabase'
import { createChild } from '../children/api'
import { logActivityAuto } from '../settings/api'

export interface TourRequest {
  id: string
  parent_name: string
  parent_phone: string
  child_name: string
  preferred_at: string | null
  note: string | null
  status: 'new' | 'contacted' | 'done' | 'converted'
  converted_child_id: string | null
  created_at: string
}

export async function listTourRequests(nurseryId: string): Promise<TourRequest[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('tour_requests')
    .select('*')
    .eq('nursery_id', nurseryId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as TourRequest[]
}

export async function setTourStatus(
  nurseryId: string,
  id: string,
  status: TourRequest['status'],
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('tour_requests')
    .update({ status })
    .eq('id', id)
  if (error) throw error
  void nurseryId
}

/** التحويل لتسجيل: طفل + وصي + تسجيل فصل عبر مسار إنشاء الطفل نفسه. */
export async function convertTourRequest(
  nurseryId: string,
  req: TourRequest,
  classId: string | null,
): Promise<string> {
  const childId = await createChild(nurseryId, {
    full_name: req.child_name,
    birth_date: null,
    gender: null,
    photo_consent: false,
    notes: null,
    class_id: classId,
    guardian_name: req.parent_name,
    guardian_phone: req.parent_phone,
    guardian_relation: null,
  })
  const db = requireSupabase()
  const { error } = await db
    .from('tour_requests')
    .update({ status: 'converted', converted_child_id: childId })
    .eq('id', req.id)
  if (error) throw error
  await logActivityAuto(nurseryId, 'tour_converted', req.child_name)
  return childId
}
