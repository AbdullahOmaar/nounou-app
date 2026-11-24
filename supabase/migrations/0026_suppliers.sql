-- دفتر الموردين والآجل (مهمة 1.4): موردون بشروط ائتمان + أوامر شراء
-- باستحقاق + دفعات. الدفعة تُنشئ قيد خزنة مقابلاً (ref) فتتدفق إلى
-- إقفال الوردية، وتُخصم في ربح الشهر من طبقة المالية لا من جدول
-- المصروفات (منع ازدواج الخصم). المالية للمالك فقط بـRLS.
create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  name        text not null,
  phone       text,
  credit_days integer not null default 0 check (credit_days >= 0),
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index suppliers_nursery_idx on public.suppliers (nursery_id);

create table public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  nursery_id   uuid not null references public.nurseries (id) on delete cascade,
  supplier_id  uuid not null references public.suppliers (id) on delete cascade,
  title        text not null,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  order_date   date not null,
  due_date     date not null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index purchase_orders_supplier_idx
  on public.purchase_orders (supplier_id, due_date);

create table public.supplier_payments (
  id               uuid primary key default gen_random_uuid(),
  nursery_id       uuid not null references public.nurseries (id) on delete cascade,
  order_id         uuid not null references public.purchase_orders (id) on delete cascade,
  amount           numeric(12, 2) not null check (amount > 0),
  paid_date        date not null,
  cashbox_entry_id uuid references public.cashbox_entries (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index supplier_payments_order_idx
  on public.supplier_payments (order_id, paid_date);

alter table public.suppliers enable row level security;
create policy suppliers_owner_all on public.suppliers for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

alter table public.purchase_orders enable row level security;
create policy purchase_orders_owner_all on public.purchase_orders for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

alter table public.supplier_payments enable row level security;
create policy supplier_payments_owner_all on public.supplier_payments for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));
