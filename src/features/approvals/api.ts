import { requireSupabase } from '../../lib/supabase'
import type { ApprovalKind, PendingApprovalRow } from '../../types/database'
import { logActivity } from '../settings/api'

/** حدود الاعتماد الثاني (ورقة 1.1 — تُراجع بعد أول شهر بايلوت) */
export const PROOF_APPROVAL_LIMIT = 2000
export const EXPENSE_APPROVAL_LIMIT = 5000

/** حفظ فعل مالي معلّقاً بدل تنفيذه — يُسجَّل الطلب في سجل النشاط */
export async function requestApproval(
  nurseryId: string,
  actorId: string | null,
  kind: ApprovalKind,
  payload: Record<string, unknown>,
  summary: string,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('pending_approvals').insert({
    nursery_id: nurseryId,
    action_kind: kind,
    payload,
    summary,
    requested_by: actorId,
  })
  if (error) throw error
  await logActivity(nurseryId, actorId, 'approval_requested', summary)
}

export async function listPendingApprovals(
  nurseryId: string,
): Promise<PendingApprovalRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('pending_approvals')
    .select('*')
    .eq('nursery_id', nurseryId)
    .eq('status', 'pending')
    .order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as PendingApprovalRow[]
}

export async function markDecided(
  nurseryId: string,
  actorId: string | null,
  row: PendingApprovalRow,
  approved: boolean,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('pending_approvals')
    .update({
      status: approved ? 'approved' : 'rejected',
      decided_by: actorId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'pending')
  if (error) throw error
  await logActivity(
    nurseryId,
    actorId,
    approved ? 'approval_approved' : 'approval_rejected',
    row.summary,
  )
}
