-- تصحيح حارس اليوم المقفل (0024): حذف الحضانة نفسها (cascade) كان
-- يصطدم بالحارس عبر حذف مصروفاتها/قيودها المتسلسل — فصارت الحضانة
-- ذات اليوم المقفل غير قابلة للحذف أصلاً (كسر تنظيف اختبارات authz).
-- القاعدة: إن كانت الحضانة نفسها محذوفة في نفس العملية فالحارس يمرّ؛
-- التجميد يحمي الكتابات المباشرة على يوم مقفل فقط.
create or replace function public.guard_cashbox_day_open()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nursery uuid;
  v_date date;
begin
  if tg_table_name = 'cashbox_entries' then
    if tg_op = 'DELETE' then
      v_nursery := old.nursery_id;
      v_date := old.entry_date;
    else
      v_nursery := new.nursery_id;
      v_date := new.entry_date;
    end if;
  else
    if tg_op = 'DELETE' then
      v_nursery := old.nursery_id;
      v_date := old.expense_date;
    else
      v_nursery := new.nursery_id;
      v_date := new.expense_date;
    end if;
  end if;
  -- حذف الحضانة المتسلسل: الصف الأب محذوف أصلاً في نفس العملية
  if not exists (select 1 from public.nurseries n where n.id = v_nursery) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if exists (select 1 from public.cashbox_closes c
             where c.nursery_id = v_nursery and c.shift_date = v_date) then
    raise exception 'cashbox_day_closed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
