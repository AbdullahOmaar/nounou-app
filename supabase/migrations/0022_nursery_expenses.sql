-- 419 (مهمة 1.2): المصروفات التشغيلية — النصف الثاني من صورة المال.
-- المالية للمالك فقط على مستوى RLS (قاعدة المشروع: لا مفتاح صلاحية
-- مالية للطاقم أبداً). الربح والخزنة اليومية عروض محسوبة من الدفعات
-- والمصروفات، لا جداول مجمّعة.
create table public.nursery_expenses (
  id           uuid primary key default gen_random_uuid(),
  nursery_id   uuid not null references public.nurseries (id) on delete cascade,
  period       text not null,
  expense_date date not null,
  category     text not null check (category in
                 ('salaries', 'rent', 'food', 'transport', 'supplies',
                  'maintenance', 'other')),
  title        text not null,
  amount       numeric(12, 2) not null check (amount > 0),
  note         text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index nursery_expenses_nursery_period_idx
  on public.nursery_expenses (nursery_id, period, expense_date);

alter table public.nursery_expenses enable row level security;
create policy nursery_expenses_owner_all on public.nursery_expenses for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));
