-- ============================================================================
-- نونو — 0017_bus_handover_and_photo_guards.sql
-- دفعة سلامة/اكتمال 3A-378 (جولة تفكير ٩ — اعتماد المدير 2026-11-23):
--
-- X1 • تسليم الباص بعد الضهر لازم يسجّل لمين: عمود جديد
--      handed_to_doorstep (باب البيت اختيار صريح مسجَّل، لا افتراض صامت
--      — قرار ق١١ كان «غياب handed_to = باب البيت»؛ الدفعة دي تحوّل
--      الغياب الصامت إلى اختيار مسجَّل) + مشغّل يرفض أي إدراج/تحديث
--      يعلّم دخول قايمة نزول (to_home) كمُنجَز بلا مستلم (لا
--      handed_to ولا باب البيت). قايمة الركوب (to_nursery) بلا قيد.
-- X3 • وسم صور لطفل بلا موافقة تصوير: مشغّل يرفض إدراج رابط
--      photo_children لطفل photo_consent = false — الرفض عند المصدر
--      (لا تخزين ولا رابط)؛ فحص العرض لحظة الفتح في البوابة (0006)
--      يبقى طبقة ثانية.
-- X2 • تقرير يومي لطفل غائب/في إجازة: مشغّل يرفض إدراج/تحديث تقرير
--      يومي لطفل له صف حضور بنفس يوم الفصل بحالة absent أو leave.
--      صف بلا حضور (اليوم لسه بيتسجَّل) مسموح — البوابة الحاسمة عند
--      النشر في طبقة التطبيق (publishDayReports يصفّي الغائبين).
--
-- كل دوال المشغّلات security definer بلا وصول RPC (نمط 0013) —
-- يجب أن تعمل لسياقات بلا auth.uid() أيضاً.
-- تُطبَّق حية بعد دمج PR الدفعة — لا تُعاد.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- X1: عمود «باب البيت» الصريح
-- ----------------------------------------------------------------------------
alter table public.bus_day_entries
  add column handed_to_doorstep boolean not null default false;

-- ----------------------------------------------------------------------------
-- X1: حارس تسليم الباص
-- ----------------------------------------------------------------------------
create or replace function public.guard_bus_handover()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  list_direction bus_direction;
begin
  if new.status = 'done' then
    select direction into list_direction
      from public.bus_day_lists where id = new.list_id;
    if list_direction = 'to_home'
      and new.handed_to is null
      and not coalesce(new.handed_to_doorstep, false) then
      raise exception 'handed_to_required';
    end if;
  end if;
  return new;
end $$;

-- دالة مشغّل داخلية: لا تُستدعى عبر RPC إطلاقاً
revoke execute on function public.guard_bus_handover() from public, anon, authenticated;

create trigger bus_day_entries_handover_trg
  before insert or update on public.bus_day_entries
  for each row execute function public.guard_bus_handover();

-- ----------------------------------------------------------------------------
-- X3: حارس موافقة التصوير عند الربط
-- ----------------------------------------------------------------------------
create or replace function public.guard_photo_consent()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  consent boolean;
begin
  select photo_consent into consent
    from public.children where id = new.child_id;
  if consent is not true then
    raise exception 'photo_consent_required';
  end if;
  return new;
end $$;

-- دالة مشغّل داخلية: لا تُستدعى عبر RPC إطلاقاً
revoke execute on function public.guard_photo_consent() from public, anon, authenticated;

create trigger photo_children_consent_trg
  before insert on public.photo_children
  for each row execute function public.guard_photo_consent();

-- ----------------------------------------------------------------------------
-- X2: حارس تقرير الغائب / في إجازة
-- ----------------------------------------------------------------------------
create or replace function public.guard_absent_report()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  att_status attendance_status;
begin
  select status into att_status
    from public.attendance
    where class_day_id = new.class_day_id and child_id = new.child_id;
  if att_status in ('absent', 'leave') then
    raise exception 'report_for_absent_child';
  end if;
  return new;
end $$;

-- دالة مشغّل داخلية: لا تُستدعى عبر RPC إطلاقاً
revoke execute on function public.guard_absent_report() from public, anon, authenticated;

create trigger daily_reports_absent_trg
  before insert or update on public.daily_reports
  for each row execute function public.guard_absent_report();

commit;
