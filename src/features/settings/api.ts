import { requireSupabase } from '../../lib/supabase'
import type {
  MemberPermissions,
  NurseryMemberRow,
  NurseryRow,
  NurserySettingsRow,
} from '../../types/database'

export async function getNurserySettings(
  nurseryId: string,
): Promise<NurserySettingsRow> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nursery_settings')
    .select('*')
    .eq('nursery_id', nurseryId)
    .single()
  if (error) throw error
  return data as NurserySettingsRow
}

export async function updateNurserySettings(
  nurseryId: string,
  patch: Partial<
    Pick<
      NurserySettingsRow,
      | 'receipt_message_template'
      | 'reminder_template'
      | 'sibling_discount_percent'
      | 'photo_daily_cap'
      | 'photo_retention_days'
      | 'pickup_code_enabled'
      | 'day_end_time'
      | 'theme'
    >
  >,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('nursery_settings')
    .update(patch)
    .eq('nursery_id', nurseryId)
  if (error) throw error
}

export async function updateNurseryProfile(
  nurseryId: string,
  patch: Partial<Pick<NurseryRow, 'name' | 'phone' | 'address'>>,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nurseries').update(patch).eq('id', nurseryId)
  if (error) throw error
}

export interface MemberListItem extends NurseryMemberRow {
  display_name: string
}

export async function listMembers(nurseryId: string): Promise<MemberListItem[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nursery_members')
    .select('*')
    .eq('nursery_id', nurseryId)
    .order('created_at')
  if (error) throw error
  const members = (data ?? []) as NurseryMemberRow[]
  const userIds = members.map((m) => m.user_id).filter(Boolean) as string[]
  let names = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: users } = await db
      .from('users')
      .select('id, display_name')
      .in('id', userIds)
    names = new Map(
      (users ?? []).map((u) => [u.id as string, u.display_name as string]),
    )
  }
  return members.map((m) => ({
    ...m,
    display_name: m.user_id
      ? (names.get(m.user_id) ?? '')
      : (m.invited_email ?? ''),
  }))
}

/** دعوة عضو بالبريد (تُدّعى تلقائياً عند أول دخول بنفس البريد — 0007) */
export async function inviteMember(
  nurseryId: string,
  email: string,
  permissions: MemberPermissions,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_members').insert({
    nursery_id: nurseryId,
    user_id: null,
    invited_email: email.trim().toLowerCase(),
    role: 'staff',
    permissions,
    status: 'invited',
  })
  if (error) throw error
}

export async function updateMember(
  memberId: string,
  patch: Partial<Pick<NurseryMemberRow, 'permissions' | 'status'>>,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_members').update(patch).eq('id', memberId)
  if (error) throw error
}

export async function removeMember(memberId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_members').delete().eq('id', memberId)
  if (error) throw error
}

export async function logActivity(
  nurseryId: string,
  actorId: string | null,
  kind: string,
  summary: string,
  entityType?: string,
  entityId?: string,
): Promise<void> {
  const db = requireSupabase()
  // سجل النشاط ثانوي: فشله لا يكسر العملية الأساسية أبداً
  await db.from('activity_log').insert({
    nursery_id: nurseryId,
    actor_id: actorId,
    kind,
    summary,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
  })
}
