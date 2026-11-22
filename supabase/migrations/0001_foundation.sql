-- ============================================================================
-- نونو — 0001_foundation.sql
-- الأساس: هوية المستخدمين + الحضانات (multi-tenant من اليوم الأول) +
-- العضويات والصلاحيات + الإعدادات + دوال RLS المساعدة + مخازن الصور.
--
-- مبادئ (مواصفة الدلتا §٢ + معايير الهندسة والأمان):
-- • كل جدول تشغيلي يحمل nursery_id وRLS مفعّلة من أول يوم — لا جدول بلا سياسة.
-- • المالية للمالك فقط على مستوى RLS (لا مفتاح مالية للمشرفات أصلاً).
-- • التوكنات العامة hash-only (SHA-256) — تُبنى في 0006.
-- • الأنماط منقولة من تطبيق المدرس المُثبت (0001/0005/0016) وموثقة في
--   docs/REUSE-MAP.md.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- Stub لـ auth.uid()/auth.users عند التشغيل على PostgreSQL خام للتجربة.
create schema if not exists auth;

do $$
begin
  if to_regclass('auth.users') is null then
    create table auth.users (id uuid primary key);
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid
      language sql stable as $f$ select null::uuid $f$;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type member_role as enum ('owner', 'staff');
create type member_status as enum ('invited', 'active', 'suspended');
create type payment_method as enum ('cash', 'vodafone_cash', 'instapay', 'bank_transfer');

-- ----------------------------------------------------------------------------
-- دوال عامة
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- كود طفل عشوائي غير تسلسلي (8 أحرف بلا ملتبسات) — منقول من المدرس
create or replace function public.generate_public_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

-- كود استلام يومي دوّار (٦ أرقام) — يُولّد كسولاً لكل طفل/يوم
create or replace function public.generate_pickup_code()
returns text language plpgsql volatile as $$
begin
  return lpad((floor(random() * 1000000))::int::text, 6, '0');
end $$;

commit;

begin;

-- ============================================================================
-- الهوية والحضانات والعضويات
-- ============================================================================

-- بروفايل المستخدم (id = حساب Auth نفسه) — نقش المدرس
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  phone        text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger users_updated_trg before update on public.users
  for each row execute function public.set_updated_at();

-- الحضانة = المستأجر (tenant)
create table public.nurseries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_url    text,
  phone       text,
  address     text,
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger nurseries_updated_trg before update on public.nurseries
  for each row execute function public.set_updated_at();

-- عضوية مستخدم في حضانة + صلاحياته (مفاتيح jsonb)
-- مفاتيح الصلاحيات: can_manage_children, can_manage_classes, can_take_attendance,
-- can_manage_reports, can_manage_photos, can_manage_bus, can_manage_announcements,
-- can_view_children, can_review_proofs (موجود في النموذج — مقفول في الـ MVP: ق٩)
-- ملاحظة صلبة: لا مفتاح مالية للمشرفات — المالية سياسات مالك فقط.
create table public.nursery_members (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        member_role not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,
  status      member_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (nursery_id, user_id)
);
create index nursery_members_user_idx on public.nursery_members (user_id);
create index nursery_members_nursery_idx on public.nursery_members (nursery_id);
create trigger nursery_members_updated_trg before update on public.nursery_members
  for each row execute function public.set_updated_at();

-- إعدادات الحضانة (صف واحد لكل حضانة)
create table public.nursery_settings (
  nursery_id               uuid primary key references public.nurseries (id) on delete cascade,
  receipt_message_template text not null default 'أهلاً {guardian}، إيصال {name} عن {period}: المدفوع {paid} من {total}، والمتبقي {balance}. شكراً لكم.',
  reminder_template        text not null default 'أهلاً {guardian}، نذكّركم بلطف أن على {name} متبقي {balance} عن {period}. شكراً لكم.',
  -- نسبة خصم الإخوات على سطر الأساس فقط (قرار ق١٤ — افتراض يُتحقق مع البايلوت)
  sibling_discount_percent numeric(5,2) not null default 10 check (sibling_discount_percent between 0 and 100),
  -- سياسة الصور (قرار ق٨)
  photo_daily_cap          int check (photo_daily_cap is null or photo_daily_cap > 0),
  photo_retention_days     int not null default 180 check (photo_retention_days > 0),
  -- آلية الاستلام: كود دوّار فوق تسجيل المشرفة (قرار ق٦) — افتراضياً مقفول
  pickup_code_enabled      boolean not null default false,
  -- يوم العمل الافتراضي (لتنبيه «حاضرون لم يُستلموا»)
  day_end_time             time not null default '13:00',
  theme                    text not null default 'auto' check (theme in ('auto','light','dark')),
  last_export_at           timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger nursery_settings_updated_trg before update on public.nursery_settings
  for each row execute function public.set_updated_at();

-- سجل النشاط (منقول من المدرس 0009 — يُكتب من العميل ويُقرأ للمالك/الأعضاء)
create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  kind        text not null,
  entity_type text,
  entity_id   uuid,
  summary     text not null default '',
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index activity_log_nursery_idx on public.activity_log (nursery_id, created_at desc);

-- ----------------------------------------------------------------------------
-- دوال RLS المساعدة (نمط المدرس: لا مقارنة مباشرة tenant_id = auth.uid())
-- ----------------------------------------------------------------------------
create or replace function public.is_nursery_owner(p_nursery uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.nursery_members m
    where m.nursery_id = p_nursery and m.user_id = auth.uid()
      and m.role = 'owner' and m.status = 'active'
  );
$$;

create or replace function public.is_nursery_member(p_nursery uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.nursery_members m
    where m.nursery_id = p_nursery and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.member_has_permission(p_nursery uuid, p_key text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.nursery_members m
    where m.nursery_id = p_nursery and m.user_id = auth.uid()
      and m.status = 'active'
      and (m.role = 'owner' or coalesce((m.permissions ->> p_key)::boolean, false))
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS: الهوية والحضانات
-- ----------------------------------------------------------------------------
alter table public.users enable row level security;
create policy users_self_select on public.users for select
  using (id = auth.uid());
create policy users_self_update on public.users for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy users_self_insert on public.users for insert
  with check (id = auth.uid());
-- الأعضاء يرون بروفايلات زملاء نفس الحضانة (أسماء الطاقم في القوائم)
create policy users_co_member_select on public.users for select
  using (exists (
    select 1 from public.nursery_members mine
    join public.nursery_members theirs
      on theirs.nursery_id = mine.nursery_id and theirs.user_id = public.users.id
    where mine.user_id = auth.uid() and mine.status = 'active' and theirs.status = 'active'
  ));

alter table public.nurseries enable row level security;
create policy nurseries_member_select on public.nurseries for select
  using (public.is_nursery_member(id));
create policy nurseries_owner_update on public.nurseries for update
  using (public.is_nursery_owner(id)) with check (public.is_nursery_owner(id));
-- الإنشاء عبر RPC create_nursery فقط (security definer) — لا insert مباشر

alter table public.nursery_members enable row level security;
create policy nursery_members_select on public.nursery_members for select
  using (public.is_nursery_member(nursery_id));
create policy nursery_members_owner_write on public.nursery_members for insert
  with check (public.is_nursery_owner(nursery_id));
create policy nursery_members_owner_update on public.nursery_members for update
  using (public.is_nursery_owner(nursery_id)) with check (public.is_nursery_owner(nursery_id));
create policy nursery_members_owner_delete on public.nursery_members for delete
  using (public.is_nursery_owner(nursery_id));

alter table public.nursery_settings enable row level security;
create policy nursery_settings_member_select on public.nursery_settings for select
  using (public.is_nursery_member(nursery_id));
create policy nursery_settings_owner_update on public.nursery_settings for update
  using (public.is_nursery_owner(nursery_id)) with check (public.is_nursery_owner(nursery_id));

alter table public.activity_log enable row level security;
create policy activity_member_select on public.activity_log for select
  using (public.is_nursery_member(nursery_id));
create policy activity_member_insert on public.activity_log for insert
  with check (public.is_nursery_member(nursery_id) and actor_id = auth.uid());

-- ----------------------------------------------------------------------------
-- إنشاء حضانة ذرّياً (حضانة + عضوية مالك + إعدادات) — نمط إنشاء حساب المدرس
-- ----------------------------------------------------------------------------
create or replace function public.create_nursery(p_name text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name_required';
  end if;
  insert into public.nurseries (name, created_by) values (trim(p_name), v_uid)
  returning id into v_id;
  insert into public.nursery_members (nursery_id, user_id, role, status)
  values (v_id, v_uid, 'owner', 'active');
  insert into public.nursery_settings (nursery_id) values (v_id);
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- مخازن الملفات (صور الأطفال + إثباتات الدفع) — buckets خاصة، صور فقط
-- سياسات الكائنات التفصيلية في 0005 (صور) و0003 (إثباتات)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('child-media', 'child-media', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

commit;
