-- ============================================================================
-- نونو — 0004_operations.sql
-- التشغيل اليومي: أيام الفصول + أحداث الحضور/الاستلام + الباص البسيط.
-- ============================================================================

begin;

create type day_status as enum ('open', 'closed');
create type attendance_status as enum ('present', 'absent', 'leave', 'early_leave');
create type bus_direction as enum ('to_nursery', 'to_home');
create type bus_entry_status as enum ('pending', 'done', 'absent');

-- ----------------------------------------------------------------------------
-- يوم الفصل — يُولّد كسولاً عند أول فتح (نمط جلسات المدرس)
-- ----------------------------------------------------------------------------
create table public.class_days (
  id         uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  class_id   uuid not null references public.classes (id) on delete cascade,
  day_date   date not null,
  status     day_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, day_date)
);
create index class_days_nursery_date_idx on public.class_days (nursery_id, day_date);
create trigger class_days_updated_trg before update on public.class_days
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- الحضور والاستلام: صف واحد لكل طفل × يوم فصل — أحداث لا سجل حالة فقط
-- ----------------------------------------------------------------------------
create table public.attendance (
  id                uuid primary key default gen_random_uuid(),
  nursery_id        uuid not null references public.nurseries (id) on delete cascade,
  class_day_id      uuid not null references public.class_days (id) on delete cascade,
  child_id          uuid not null references public.children (id) on delete cascade,
  status            attendance_status not null default 'present',
  arrived_at        timestamptz,
  arrived_by        uuid references auth.users (id),
  arrival_method    text check (arrival_method is null or arrival_method in ('manual','qr')),
  -- الاستلام: من القايمة المصرح لها فقط (يُفرض في طبقة التطبيق + مراجعة authz)
  picked_up_at      timestamptz,
  picked_up_by      uuid references public.pickup_persons (id) on delete set null,
  picked_up_guardian boolean not null default false,
  handed_by         uuid references auth.users (id),
  pickup_code_used  boolean not null default false,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (class_day_id, child_id)
);
create index attendance_day_idx on public.attendance (class_day_id);
create index attendance_child_idx on public.attendance (child_id, created_at desc);
create index attendance_not_picked_idx on public.attendance (nursery_id, picked_up_at)
  where status = 'present';
create trigger attendance_updated_trg before update on public.attendance
  for each row execute function public.set_updated_at();

-- أكواد الاستلام اليومية (توجد فقط عند تفعيل إعداد الحضانة — قرار ق٦)
create table public.pickup_codes (
  id         uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  child_id   uuid not null references public.children (id) on delete cascade,
  day_date   date not null,
  code       text not null,
  created_at timestamptz not null default now(),
  unique (child_id, day_date)
);

-- ----------------------------------------------------------------------------
-- الباص البسيط: خطوط + قوائم يومية + بنود تعليم (لا GPS — خارج النطاق صراحة)
-- ----------------------------------------------------------------------------
create table public.bus_routes (
  id                   uuid primary key default gen_random_uuid(),
  nursery_id           uuid not null references public.nurseries (id) on delete cascade,
  name                 text not null,
  supervisor_member_id uuid references public.nursery_members (id) on delete set null,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index bus_routes_nursery_idx on public.bus_routes (nursery_id, is_active);
create trigger bus_routes_updated_trg before update on public.bus_routes
  for each row execute function public.set_updated_at();

create table public.bus_day_lists (
  id         uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  route_id   uuid not null references public.bus_routes (id) on delete cascade,
  day_date   date not null,
  direction  bus_direction not null,
  created_at timestamptz not null default now(),
  unique (route_id, day_date, direction)
);
create index bus_day_lists_nursery_idx on public.bus_day_lists (nursery_id, day_date);

create table public.bus_day_entries (
  id         uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  list_id    uuid not null references public.bus_day_lists (id) on delete cascade,
  child_id   uuid not null references public.children (id) on delete cascade,
  status     bus_entry_status not null default 'pending',
  done_at    timestamptz,
  done_by    uuid references auth.users (id),
  -- عند النزول بعد الضهر: اتسلّم لمين (اختياري — غيابه = باب البيت، قرار ق١١)
  handed_to  uuid references public.pickup_persons (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (list_id, child_id)
);
create index bus_day_entries_list_idx on public.bus_day_entries (list_id, sort_order);
create trigger bus_day_entries_updated_trg before update on public.bus_day_entries
  for each row execute function public.set_updated_at();

-- اشتراكات الباص الشهرية (أساس سطر bus في فواتير الإصدار الجماعي)
create table public.bus_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  route_id    uuid not null references public.bus_routes (id) on delete cascade,
  monthly_fee numeric(12,2) not null default 0 check (monthly_fee >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (child_id, route_id)
);
create index bus_subscriptions_child_idx on public.bus_subscriptions (child_id, is_active);
create trigger bus_subscriptions_updated_trg before update on public.bus_subscriptions
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — صلاحية الحضور للعمليات، وإدارة الباص لصلاحيته
-- ----------------------------------------------------------------------------
alter table public.class_days enable row level security;
create policy class_days_member_select on public.class_days for select
  using (public.is_nursery_member(nursery_id));
create policy class_days_att_write on public.class_days for insert
  with check (public.member_has_permission(nursery_id, 'can_take_attendance'));
create policy class_days_att_update on public.class_days for update
  using (public.member_has_permission(nursery_id, 'can_take_attendance'))
  with check (public.member_has_permission(nursery_id, 'can_take_attendance'));

alter table public.attendance enable row level security;
create policy attendance_member_select on public.attendance for select
  using (public.is_nursery_member(nursery_id));
create policy attendance_att_write on public.attendance for insert
  with check (public.member_has_permission(nursery_id, 'can_take_attendance'));
create policy attendance_att_update on public.attendance for update
  using (public.member_has_permission(nursery_id, 'can_take_attendance'))
  with check (public.member_has_permission(nursery_id, 'can_take_attendance'));
create policy attendance_att_delete on public.attendance for delete
  using (public.member_has_permission(nursery_id, 'can_take_attendance'));

alter table public.pickup_codes enable row level security;
create policy pickup_codes_member_select on public.pickup_codes for select
  using (public.is_nursery_member(nursery_id));
create policy pickup_codes_att_write on public.pickup_codes for insert
  with check (public.member_has_permission(nursery_id, 'can_take_attendance'));

alter table public.bus_routes enable row level security;
create policy bus_routes_member_select on public.bus_routes for select
  using (public.is_nursery_member(nursery_id));
create policy bus_routes_manage_write on public.bus_routes for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));
create policy bus_routes_manage_update on public.bus_routes for update
  using (public.member_has_permission(nursery_id, 'can_manage_bus'))
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));
create policy bus_routes_manage_delete on public.bus_routes for delete
  using (public.member_has_permission(nursery_id, 'can_manage_bus'));

alter table public.bus_day_lists enable row level security;
create policy bus_lists_member_select on public.bus_day_lists for select
  using (public.is_nursery_member(nursery_id));
create policy bus_lists_bus_write on public.bus_day_lists for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));

alter table public.bus_day_entries enable row level security;
create policy bus_entries_member_select on public.bus_day_entries for select
  using (public.is_nursery_member(nursery_id));
create policy bus_entries_bus_write on public.bus_day_entries for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));
create policy bus_entries_bus_update on public.bus_day_entries for update
  using (public.member_has_permission(nursery_id, 'can_manage_bus'))
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));
create policy bus_entries_bus_delete on public.bus_day_entries for delete
  using (public.member_has_permission(nursery_id, 'can_manage_bus'));

alter table public.bus_subscriptions enable row level security;
create policy bus_subs_member_select on public.bus_subscriptions for select
  using (public.is_nursery_member(nursery_id));
create policy bus_subs_manage_write on public.bus_subscriptions for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));
create policy bus_subs_manage_update on public.bus_subscriptions for update
  using (public.member_has_permission(nursery_id, 'can_manage_bus'))
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));
create policy bus_subs_manage_delete on public.bus_subscriptions for delete
  using (public.member_has_permission(nursery_id, 'can_manage_bus'));

commit;
