-- ============================================================================
-- نونو — 0011_photo_retention.sql
-- إنفاذ سياسة الاحتفاظ بالصور (قرار ق٨ — دفعة 3A-335):
-- الإعداد photo_retention_days كان موجوداً منذ 0001 بلا أي آلية حذف، فكانت
-- الصور ستتراكم في التخزين بلا حد بعد التفعيل. هذه الهجرة تبني طبقة
-- القاعدة للآلية، ودالة الحافة photo-retention تنفّذ الحذف الفعلي:
--
-- • expired_child_photos(limit): الصور التي تجاوز عمرها مدة احتفاظ
--   حضانتها (لكل حضانة مدتها من nursery_settings) — الأقدم أولاً.
-- • delete_expired_child_photo(id): يحذف سجل صورة واحدة بشرط إعادة فحص
--   الانتهاء لحظة الحذف نفسها (لا حذف لصورة داخل المدة مهما كان الطالب).
--   روابط photo_children تُحذف تتالياً (on delete cascade من 0005).
--
-- التفويض: الدالتان service_role فقط (نفس نمط nursery_portal_photo_path
-- في 0006): المنح يُسحب صراحة من public/anon/authenticated ويُمنح لـ
-- service_role وحده — فلا مالك ولا مشرفة ولا مجهول يستطيع استدعاءهما،
-- والحارس هنا هو المنح نفسه لأنهما لا تقبلان أي مدخل هوية أصلاً.
-- ترتيب التنفيذ الآمن في دالة الحافة: حذف كائن التخزين أولاً، فحذف
-- السجل — فشل أي خطوة يترك الصورة لجولة قادمة ولا يفقد سجلاً بلا ملف.
-- ============================================================================

begin;

create or replace function public.expired_child_photos(p_limit int default 500)
returns table (photo_id uuid, nursery_id uuid, storage_path text)
language sql stable security definer
set search_path = public, pg_temp as $$
  select p.id, p.nursery_id, p.storage_path
  from public.child_photos p
  join public.nursery_settings s on s.nursery_id = p.nursery_id
  where p.created_at < now() - make_interval(days => s.photo_retention_days)
  order by p.created_at asc
  limit greatest(coalesce(p_limit, 500), 0);
$$;

revoke execute on function public.expired_child_photos(int) from public, anon, authenticated;
grant execute on function public.expired_child_photos(int) to service_role;

create or replace function public.delete_expired_child_photo(p_photo_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_found boolean := false;
begin
  delete from public.child_photos p
  using public.nursery_settings s
  where p.id = p_photo_id
    and s.nursery_id = p.nursery_id
    and p.created_at < now() - make_interval(days => s.photo_retention_days);
  v_found := found;
  return v_found;
end $$;

revoke execute on function public.delete_expired_child_photo(uuid) from public, anon, authenticated;
grant execute on function public.delete_expired_child_photo(uuid) to service_role;

commit;
