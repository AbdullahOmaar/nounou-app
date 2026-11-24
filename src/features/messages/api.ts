import { requireSupabase } from '../../lib/supabase'
import { logActivityAuto } from '../settings/api'

export interface ThreadSummary {
  guardianId: string
  guardianName: string
  lastBody: string
  lastAt: string
  lastSender: 'guardian' | 'staff'
  unread: number
}

export interface ThreadMessage {
  id: string
  sender: 'guardian' | 'staff'
  body: string
  created_at: string
}

interface MsgRow {
  id: string
  guardian_id: string
  sender: 'guardian' | 'staff'
  body: string
  created_at: string
  read_by_staff_at: string | null
}

export async function listThreads(nurseryId: string): Promise<ThreadSummary[]> {
  const db = requireSupabase()
  const [msgRes, guardRes] = await Promise.all([
    db
      .from('portal_messages')
      .select('id, guardian_id, sender, body, created_at, read_by_staff_at')
      .eq('nursery_id', nurseryId)
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('guardians').select('id, full_name').eq('nursery_id', nurseryId),
  ])
  if (msgRes.error) throw msgRes.error
  if (guardRes.error) throw guardRes.error
  const names = new Map(
    (guardRes.data ?? []).map((g) => [g.id as string, g.full_name as string]),
  )
  const byGuardian = new Map<string, ThreadSummary>()
  for (const row of (msgRes.data ?? []) as MsgRow[]) {
    let th = byGuardian.get(row.guardian_id)
    if (!th) {
      th = {
        guardianId: row.guardian_id,
        guardianName: names.get(row.guardian_id) ?? '',
        lastBody: row.body,
        lastAt: row.created_at,
        lastSender: row.sender,
        unread: 0,
      }
      byGuardian.set(row.guardian_id, th)
    }
    if (row.sender === 'guardian' && !row.read_by_staff_at) th.unread += 1
  }
  return [...byGuardian.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
}

export async function listThreadMessages(
  nurseryId: string,
  guardianId: string,
): Promise<ThreadMessage[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('portal_messages')
    .select('id, sender, body, created_at')
    .eq('nursery_id', nurseryId)
    .eq('guardian_id', guardianId)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []) as ThreadMessage[]
}

export async function markThreadRead(
  nurseryId: string,
  guardianId: string,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('portal_messages')
    .update({ read_by_staff_at: new Date().toISOString() })
    .eq('nursery_id', nurseryId)
    .eq('guardian_id', guardianId)
    .eq('sender', 'guardian')
    .is('read_by_staff_at', null)
  if (error) throw error
}

export async function sendStaffMessage(
  nurseryId: string,
  guardianId: string,
  body: string,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('portal_messages').insert({
    nursery_id: nurseryId,
    guardian_id: guardianId,
    sender: 'staff',
    body: body.trim(),
  })
  if (error) throw error
  void logActivityAuto(nurseryId, 'message_sent', 'portal message', 'guardian', guardianId)
}
