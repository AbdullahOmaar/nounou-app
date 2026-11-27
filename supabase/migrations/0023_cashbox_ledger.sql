-- الخزنة (مهمة 1.3): دفتر حركات نقدية يدوية (مشتريات/مبيعات/أخرى)
-- + إقفال وردية برسالة تسليم موثّقة. المالية للمالك فقط بـRLS.
-- اليوم المُقفل يُجمَّد خادمياً: أي تعديل على قيود الخزنة أو مصروفات
-- ذلك اليوم يُرفض بمُشغّل — الإقفال وثيقة لا تُعاد كتابتها.
create table public.cashbox_entries (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  entry_date  date not null,
  direction   text not null check (direction in ('in', 'out')),
  kind        text not null check (kind in
                ('purchase', 'sale', 'misc_in', 'misc_out')),
  title       text not null,
  amount      numeric(12, 2) not null check (amount > 0),
  ref_type    text,
  ref_id      uuid,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index cashbox_entries_nursery_date_idx
  on public.cashbox_entries (nursery_id, entry_date);

create table public.cashbox_closes (
  id             uuid primary key default gen_random_uuid(),
  nursery_id     uuid not null references public.nurseries (id) on delete cascade,
  shift_date     date not null,
  expected_total numeric(12, 2) not null,
  counted_total  numeric(12, 2) not null,
  difference     numeric(12, 2) not null,
  handover_to    text not null,
  note           text,
  closed_by      uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (nursery_id, shift_date)
);

alter table public.cashbox_entries enable row level security;
create policy cashbox_entries_owner_all on public.cashbox_entries for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

alter table public.cashbox_closes enable row level security;
create policy cashbox_closes_owner_all on public.cashbox_closes for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

-- تجميد اليوم المقفل: يرفض أي كتابة على قيود/مصروفات يوم أُقفلت ورديته
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
  if tg_op = 'DELETE' then
    v_nursery := old.nursery_id;
    v_date := coalesce(old.entry_date, old.expense_date);
  else
    v_nursery := new.nursery_id;
    v_date := coalesce(new.entry_date, new.expense_date);
  end if;
  if exists (select 1 from public.cashbox_closes c
             where c.nursery_id = v_nursery and c.shift_date = v_date) then
    raise exception 'cashbox_day_closed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger cashbox_entries_open_guard
  before insert or update or delete on public.cashbox_entries
  for each row execute function public.guard_cashbox_day_open();

create trigger nursery_expenses_open_guard
  before insert or update or delete on public.nursery_expenses
  for each row execute function public.guard_cashbox_day_open();
