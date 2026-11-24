-- إصلاح كامن من 0030 اكتشفته مهمة 2.8: فرع «كل أوصياء الحضانة» في
-- emit_guardian_notification كان يمرر null بلا تحويل نوع فيفشل
-- 42804 عند أي إشعار عام (جلسة أسئلة/إعلان) — يُعاد إنشاء الدالة
-- بتحويل صريح null::uuid.
create or replace function public.emit_guardian_notification(
  p_nursery uuid, p_child uuid, p_guardian uuid, p_kind text, p_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_guardian is not null then
    insert into public.guardian_notifications
      (nursery_id, guardian_id, child_id, kind, meta)
    values (p_nursery, p_guardian, p_child, p_kind, p_meta);
  elsif p_child is not null then
    insert into public.guardian_notifications
      (nursery_id, guardian_id, child_id, kind, meta)
    select p_nursery, gc.guardian_id, p_child, p_kind, p_meta
    from public.guardian_children gc
    where gc.child_id = p_child;
  else
    insert into public.guardian_notifications
      (nursery_id, guardian_id, child_id, kind, meta)
    select distinct p_nursery, gc.guardian_id, null::uuid, p_kind, p_meta
    from public.guardian_children gc
    join public.children c on c.id = gc.child_id
    where c.nursery_id = p_nursery;
  end if;
end $$;
