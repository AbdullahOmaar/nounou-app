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
  await logActivityAuto(nurseryId, 'settings_updated', Object.keys(patch).join(', '))
}

export async function updateNurseryProfile(
  nurseryId: string,
  patch: Partial<Pick<NurseryRow, 'name' | 'phone' | 'address' | 'logo_url' | 'brand_color'>>,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nurseries').update(patch).eq('id', nurseryId)
  if (error) throw error
}

export async function getPublicPageSettings(nurseryId: string) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nurseries')
    .select('public_slug, public_enabled, public_about, public_license_no, public_instapay, public_vodafone, public_bank')
    .eq('id', nurseryId)
    .single()
  if (error) throw error
  return data as Pick<
    NurseryRow,
    | 'public_slug'
    | 'public_enabled'
    | 'public_about'
    | 'public_license_no'
    | 'public_instapay'
    | 'public_vodafone'
    | 'public_bank'
  >
}

export async function updatePublicPageSettings(
  nurseryId: string,
  patch: Partial<
    Pick<
      NurseryRow,
      | 'public_slug'
      | 'public_enabled'
      | 'public_about'
      | 'public_license_no'
      | 'public_instapay'
      | 'public_vodafone'
      | 'public_bank'
    >
  >,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nurseries').update(patch).eq('id', nurseryId)
  if (error) throw error
  await logActivityAuto(nurseryId, 'settings_updated', 'public_page')
}

export interface PublicPageStats {
  views: number
  clicks: number
  byPage: Record<string, number>
}

export async function getPublicPageStats(
  nurseryId: string,
): Promise<PublicPageStats> {
  const db = requireSupabase()
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await db
    .from('public_page_events')
    .select('kind, page')
    .eq('nursery_id', nurseryId)
    .gte('created_at', since)
    .limit(5000)
  if (error) throw error
  const rows = (data ?? []) as Array<{ kind: string; page: string }>
  const stats: PublicPageStats = { views: 0, clicks: 0, byPage: {} }
  for (const r of rows) {
    if (r.kind === 'view') {
      stats.views++
      stats.byPage[r.page] = (stats.byPage[r.page] ?? 0) + 1
    } else if (r.kind === 'whatsapp_click') {
      stats.clicks++
    }
  }
  return stats
}

export async function uploadNurseryLogo(
  nurseryId: string,
  file: File,
): Promise<string> {
  const db = requireSupabase()
  const path = `${nurseryId}/logo.jpg`
  const { error } = await db.storage
    .from('nursery-logos')
    .upload(path, file, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  const { data } = db.storage.from('nursery-logos').getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
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
  await logActivityAuto(nurseryId, 'member_invited', email.trim().toLowerCase(), 'member')
}

export type InviteEmailStatus = 'sent' | 'not_configured' | 'failed'

/**
 * إرسال بريد الدعوة عبر دالة send-invite-email (Brevo — 0.7). لا يرمي أبداً:
 * الدعوة محفوظة أصلاً، والإيميل طبقة إشعار — نتيجته تُعرض للمالك كتوست.
 */
export async function sendInviteEmail(
  nurseryId: string,
  email: string,
): Promise<InviteEmailStatus> {
  const db = requireSupabase()
  try {
    const { data, error } = await db.functions.invoke('send-invite-email', {
      body: { nurseryId, email: email.trim().toLowerCase() },
    })
    if (error) {
      // خطأ HTTP من الدالة (503 غير مهيأة / 502 فشل إرسال) يصل هنا كخطأ عام
      const ctx = (error as { context?: Response }).context
      if (ctx && ctx.status === 503) return 'not_configured'
      return 'failed'
    }
    return (data as { sent?: boolean } | null)?.sent ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

export async function updateMember(
  memberId: string,
  patch: Partial<Pick<NurseryMemberRow, 'permissions' | 'status'>>,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_members').update(patch).eq('id', memberId)
  if (error) throw error
}

export async function removeMember(nurseryId: string, memberId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_members').delete().eq('id', memberId)
  if (error) throw error
  await logActivityAuto(nurseryId, 'member_removed', '', 'member', memberId)
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

/** logActivity بفاعل = المستخدم الحالي (420-U1: توصيل سجل النشاط بالأحداث) */
export async function logActivityAuto(
  nurseryId: string,
  kind: string,
  summary: string,
  entityType?: string,
  entityId?: string,
): Promise<void> {
  const db = requireSupabase()
  const { data } = await db.auth.getUser()
  await logActivity(nurseryId, data.user?.id ?? null, kind, summary, entityType, entityId)
}
