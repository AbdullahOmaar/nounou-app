-- ============================================================================
-- نونو — 0002_children_classes.sql
-- الفصول (باقات شهرية) + الأطفال + الأوصياء وعلاقاتهم + أشخاص الاستلام
-- المصرح لهم + التسجيلات (ربط طفل × فصل × سعر فعلي).
-- ============================================================================

begin;

create type enrollment_status as enum ('active', 'paused', 'left');
create type pickup_relation as enum ('father', 'mother', 'grandparent', 'driver', 'other');

-- ----------------------------------------------------------------------------
-- الفصول — الباقة الشهرية على الفصل (الدلتا §٢.٢، قرار ق١)
-- ----------------------------------------------------------------------------
create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  name        text not null,
  monthly_fee numeric(12,2) not null default 0 check (monthly_fee >= 0),
  capacity    int check (capacity is null or capacity > 0),
  age_from    numeric(4,1) check (age_from is null or age_from >= 0),
  age_to      numeric(4,1) check (age_to is null or age_to >= age_from),
  -- وحدة القيلولة في التقرير اليومي (قرار ق٣)
  nap_enabled boolean not null default true,
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index classes_nursery_idx on public.classes (nursery_id, sort_order);
create trigger classes_updated_trg before update on public.classes
  for each row execute function public.set_updated_at();

-- مشرفات الفصل (ربط عضو × فصل)
create table public.class_staff (
  class_id   uuid not null references public.classes (id) on delete cascade,
  member_id  uuid not null references public.nursery_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, member_id)
);

-- ----------------------------------------------------------------------------
-- الأطفال
-- ----------------------------------------------------------------------------
create table public.children (
  id            uuid primary key default gen_random_uuid(),
  nursery_id    uuid not null references public.nurseries (id) on delete cascade,
  full_name     text not null,
  birth_date    date,
  gender        text check (gender is null or gender in ('male','female')),
  photo_url     text,
  public_code   text not null default public.generate_public_code(),
  -- موافقة التصوير: بلا موافقة لا تظهر صورة الطفل في البوابة أبداً (فحص لحظة العرض)
  photo_consent boolean not null default false,
  notes         text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (nursery_id, public_code)
);
create index children_nursery_idx on public.children (nursery_id, full_name);
create trigger children_updated_trg before update on public.children
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- الأوصياء (أب/أم/وصي) وعلاقتهم بالأطفال — أرقامهم أساس التواصل والبوابة
-- ----------------------------------------------------------------------------
create table public.guardians (
  id         uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  full_name  text not null,
  phone      text not null,
  relation   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nursery_id, phone)
);
create index guardians_nursery_idx on public.guardians (nursery_id, full_name);
create trigger guardians_updated_trg before update on public.guardians
  for each row execute function public.set_updated_at();

create table public.guardian_children (
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  is_payer    boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (guardian_id, child_id)
);
create index guardian_children_child_idx on public.guardian_children (child_id);

-- ----------------------------------------------------------------------------
-- أشخاص الاستلام المصرح لهم (صورة اختيارية للتعرف البصري عند الباب)
-- ----------------------------------------------------------------------------
create table public.pickup_persons (
  id         uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  child_id   uuid not null references public.children (id) on delete cascade,
  full_name  text not null,
  relation   pickup_relation not null default 'other',
  phone      text,
  photo_url  text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pickup_persons_child_idx on public.pickup_persons (child_id, is_active);
create trigger pickup_persons_updated_trg before update on public.pickup_persons
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- التسجيلات: طفل × فصل بفترة وسعر فعلي (price_override يغلب باقة الفصل)
-- ----------------------------------------------------------------------------
create table public.enrollments (
  id             uuid primary key default gen_random_uuid(),
  nursery_id     uuid not null references public.nurseries (id) on delete cascade,
  child_id       uuid not null references public.children (id) on delete cascade,
  class_id       uuid not null references public.classes (id) on delete restrict,
  starts_on      date not null default current_date,
  ends_on        date,
  price_override numeric(12,2) check (price_override is null or price_override >= 0),
  status         enrollment_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index enrollments_child_idx on public.enrollments (child_id, status);
create index enrollments_class_idx on public.enrollments (class_id, status);
-- تسجيل نشط واحد لكل طفل في أي لحظة
create unique index enrollments_one_active_per_child
  on public.enrollments (child_id) where status = 'active';
create trigger enrollments_updated_trg before update on public.enrollments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.classes enable row level security;
create policy classes_member_select on public.classes for select
  using (public.is_nursery_member(nursery_id));
create policy classes_manage_write on public.classes for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_classes'));
create policy classes_manage_update on public.classes for update
  using (public.member_has_permission(nursery_id, 'can_manage_classes'))
  with check (public.member_has_permission(nursery_id, 'can_manage_classes'));
create policy classes_manage_delete on public.classes for delete
  using (public.member_has_permission(nursery_id, 'can_manage_classes'));

alter table public.class_staff enable row level security;
create policy class_staff_member_select on public.class_staff for select
  using (exists (select 1 from public.classes c
                 where c.id = class_id and public.is_nursery_member(c.nursery_id)));
create policy class_staff_manage_write on public.class_staff for insert
  with check (exists (select 1 from public.classes c
                      where c.id = class_id
                        and public.member_has_permission(c.nursery_id, 'can_manage_classes')));
create policy class_staff_manage_delete on public.class_staff for delete
  using (exists (select 1 from public.classes c
                 where c.id = class_id
                   and public.member_has_permission(c.nursery_id, 'can_manage_classes')));

alter table public.children enable row level security;
create policy children_member_select on public.children for select
  using (public.is_nursery_member(nursery_id));
create policy children_manage_write on public.children for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy children_manage_update on public.children for update
  using (public.member_has_permission(nursery_id, 'can_manage_children'))
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy children_manage_delete on public.children for delete
  using (public.member_has_permission(nursery_id, 'can_manage_children'));

alter table public.guardians enable row level security;
create policy guardians_member_select on public.guardians for select
  using (public.is_nursery_member(nursery_id));
create policy guardians_manage_write on public.guardians for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy guardians_manage_update on public.guardians for update
  using (public.member_has_permission(nursery_id, 'can_manage_children'))
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy guardians_manage_delete on public.guardians for delete
  using (public.member_has_permission(nursery_id, 'can_manage_children'));

alter table public.guardian_children enable row level security;
create policy guardian_children_member_select on public.guardian_children for select
  using (exists (select 1 from public.guardians g
                 where g.id = guardian_id and public.is_nursery_member(g.nursery_id)));
create policy guardian_children_manage_write on public.guardian_children for insert
  with check (exists (select 1 from public.guardians g
                      where g.id = guardian_id
                        and public.member_has_permission(g.nursery_id, 'can_manage_children')));
create policy guardian_children_manage_delete on public.guardian_children for delete
  using (exists (select 1 from public.guardians g
                 where g.id = guardian_id
                   and public.member_has_permission(g.nursery_id, 'can_manage_children')));

alter table public.pickup_persons enable row level security;
create policy pickup_persons_member_select on public.pickup_persons for select
  using (public.is_nursery_member(nursery_id));
create policy pickup_persons_manage_write on public.pickup_persons for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy pickup_persons_manage_update on public.pickup_persons for update
  using (public.member_has_permission(nursery_id, 'can_manage_children'))
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy pickup_persons_manage_delete on public.pickup_persons for delete
  using (public.member_has_permission(nursery_id, 'can_manage_children'));

alter table public.enrollments enable row level security;
create policy enrollments_member_select on public.enrollments for select
  using (public.is_nursery_member(nursery_id));
create policy enrollments_manage_write on public.enrollments for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy enrollments_manage_update on public.enrollments for update
  using (public.member_has_permission(nursery_id, 'can_manage_children'))
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy enrollments_manage_delete on public.enrollments for delete
  using (public.member_has_permission(nursery_id, 'can_manage_children'));

commit;
