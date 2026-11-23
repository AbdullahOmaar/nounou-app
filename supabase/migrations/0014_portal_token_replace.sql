-- ============================================================================
-- نونو — 0014_portal_token_replace.sql
-- استبدال رابط البوابة ذرياً (3A-374 / W1 — اعتماد المدير 2026-11-22):
-- إعادة إصدار رابط وصي كانت تُدرج توكناً جديداً وتبقي القديم حياً حتى
-- انتهائه (30 يوماً) — توكنان صالحان لنفس الوصي ورابط «مستبدَل» لا
-- يموت. هذه الهجرة تضيف RPC واحدة ذرّية: تُلغي كل التوكنات النشطة
-- بنفس النطاق (وصي + طفل محدد، أو وصي عام عند child_id فارغ) ثم تُدرج
-- التوكن الجديد — في معاملة واحدة، وبحارس صلاحية can_manage_children
-- (نفس نموذج سياسات كتابة التوكنات في 0006؛ المالك يمر بدوره).
-- ============================================================================

begin;

create or replace function public.replace_guardian_portal_token(
  p_nursery uuid,
  p_guardian uuid,
  p_child uuid,
  p_token_hash text
)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not public.member_has_permission(p_nursery, 'can_manage_children') then
    raise exception 'not_authorized';
  end if;

  update public.guardian_access_tokens
     set revoked_at = now()
   where nursery_id = p_nursery
     and guardian_id = p_guardian
     and child_id is not distinct from p_child
     and revoked_at is null;

  insert into public.guardian_access_tokens
    (nursery_id, guardian_id, child_id, token_hash, created_by)
  values (p_nursery, p_guardian, p_child, p_token_hash, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

commit;
