-- ============================================================================
-- نونو — 0008_finance_storage_fixes.sql
-- إصلاحات مراجعة ذاتية قبل التفعيل:
-- ١) invoice_balances كانت هتحسب سطر العكس نفسه كدفعة إضافية — الاستبعاد
--    الصحيح: لا الأصل المعكوس ولا سطر العكس يدخلان الرصيد.
-- ٢) bucket إثباتات الدفع: المالك يحتاج سياسة إدراج لمسار حضانته (تسجيل
--    دفعة إلكترونية من الإدارة بإثبات وصل على واتساب).
-- ٣) صور الأطفال: رفع صورة ملف الطفل (avatar) فعل إدارة أطفال، فيُسمح
--    به لصلاحية can_manage_children بجانب can_manage_photos.
-- ============================================================================

begin;

create or replace view public.invoice_balances as
select
  i.id as invoice_id,
  i.nursery_id,
  i.child_id,
  i.period,
  i.status,
  coalesce(sum(l.amount), 0)::numeric(12,2) as total,
  coalesce((
    select sum(p.amount) from public.payments p
    where p.invoice_id = i.id
      and p.proof_status in ('not_required', 'approved')
      and p.reversed_by_id is null
      and p.reverses_id is null
  ), 0)::numeric(12,2) as paid,
  (coalesce(sum(l.amount), 0) - coalesce((
    select sum(p.amount) from public.payments p
    where p.invoice_id = i.id
      and p.proof_status in ('not_required', 'approved')
      and p.reversed_by_id is null
      and p.reverses_id is null
  ), 0))::numeric(12,2) as balance
from public.invoices i
left join public.invoice_lines l on l.invoice_id = i.id
group by i.id, i.nursery_id, i.child_id, i.period, i.status;

create policy proofs_owner_insert on storage.objects for insert
  with check (bucket_id = 'payment-proofs'
              and public.is_nursery_owner(((storage.foldername(name))[1])::uuid));

drop policy child_media_member_insert on storage.objects;
create policy child_media_member_insert on storage.objects for insert
  with check (bucket_id = 'child-media'
              and (public.member_has_permission(((storage.foldername(name))[1])::uuid, 'can_manage_photos')
                   or public.member_has_permission(((storage.foldername(name))[1])::uuid, 'can_manage_children')));

commit;
