-- 420-U2: التحقق من كود الاستلام كان مقارنة نصية على جهاز المشرفة —
-- كل أكواد اليوم تُجلب للجهاز، ولا أثر لأي محاولة خاطئة، والكود يبقى
-- صالحاً بعد استخدامه. الآن: تحقق خادمي ذرّي عبر هذا الـ RPC.
-- used_at يعلّم الكود مستخدماً (استخدام واحد فقط)، وfailed_attempts
-- يعدّ المحاولات الخاطئة وتُسجَّل كل محاولة في سجل النشاط.
alter table public.pickup_codes
  add column if not exists used_at timestamptz;
alter table public.pickup_codes
  add column if not exists failed_attempts integer not null default 0;

create or replace function public.verify_pickup_code(
  p_nursery_id uuid, p_child_id uuid, p_day_date date, p_code text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_row public.pickup_codes;
begin
  -- حارس صريح يعمل أيضاً عند غياب الجلسة (auth.uid() خالٍ)
  if auth.uid() is null or not public.is_nursery_member(p_nursery_id) then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.pickup_codes
  where nursery_id = p_nursery_id
    and child_id = p_child_id
    and day_date = p_day_date;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_code');
  end if;
  if v_row.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;

  if v_row.code <> trim(p_code) then
    update public.pickup_codes
    set failed_attempts = failed_attempts + 1
    where id = v_row.id;
    insert into public.activity_log
      (nursery_id, actor_id, kind, entity_type, entity_id, summary, meta)
    values
      (p_nursery_id, auth.uid(), 'pickup_code_failed', 'child', p_child_id,
       'محاولة استلام بكود غير صحيح',
       jsonb_build_object('day_date', p_day_date,
                          'attempts', v_row.failed_attempts + 1));
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  -- تعليم ذرّي: صف واحد فقط ينجح حتى مع محاولتين متزامنتين
  update public.pickup_codes
  set used_at = now()
  where id = v_row.id and used_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.verify_pickup_code(uuid, uuid, date, text)
  from public, anon;
grant execute on function public.verify_pickup_code(uuid, uuid, date, text)
  to authenticated;
