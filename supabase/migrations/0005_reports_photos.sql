-- ============================================================================
-- نونو — 0005_reports_photos.sql
-- الصحة + التقرير اليومي + صور الأطفال + الإعلانات.
--
-- قاعدة الصور الصلبة: لا قراءة مباشرة لجدول الصور من البوابة — القراءة عبر
-- RPC التوكن في 0006 فقط، وموافقة التصوير تُفحص لحظة العرض، وروابط التخزين
-- موقعة قصيرة العمر. الرفع من داخل النظام فقط (مسار يولّده العميل المصرّح
-- داخل مجلد حضانته، وتفرضه سياسات التخزين أدناه).
-- ============================================================================

begin;

create type announcement_audience as enum ('all', 'class');

-- ----------------------------------------------------------------------------
-- الملف الصحي للطفل (قراءة كل الأعضاء — أمان الطفل قبل الخصوصية الداخلية)
-- ----------------------------------------------------------------------------
create table public.child_health_profiles (
  child_id          uuid primary key references public.children (id) on delete cascade,
  nursery_id        uuid not null references public.nurseries (id) on delete cascade,
  blood_type        text,
  allergies         jsonb not null default '[]'::jsonb,  -- [{name, severity, notes}]
  chronic_conditions text,
  doctor_name       text,
  doctor_phone      text,
  emergency_notes   text,
  vaccinations_note text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger child_health_updated_trg before update on public.child_health_profiles
  for each row execute function public.set_updated_at();

-- جداول الأدوية الدورية (التنفيذ/سجل الإعطاء مرحلة تالية — الدلتا §٢.٦)
create table public.medication_schedules (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  medicine    text not null,
  dose        text not null,
  times       jsonb not null default '[]'::jsonb,  -- ["08:00","12:00"]
  starts_on   date not null default current_date,
  ends_on     date,
  guardian_note text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index medication_schedules_child_idx on public.medication_schedules (child_id, is_active);
create trigger medication_schedules_updated_trg before update on public.medication_schedules
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- التقرير اليومي (قرار ق٢): وجبات JSONB + قيلولة + أنشطة + مزاج + ملاحظة
-- لا يراه ولي الأمر إلا بعد published_at (نشر صريح).
-- meals: [{meal:'breakfast'|'snack'|'lunch', ate:'all'|'most'|'some'|'none',
--          source:'home'|'nursery', note}]
-- ----------------------------------------------------------------------------
create table public.daily_reports (
  id           uuid primary key default gen_random_uuid(),
  nursery_id   uuid not null references public.nurseries (id) on delete cascade,
  class_day_id uuid not null references public.class_days (id) on delete cascade,
  child_id     uuid not null references public.children (id) on delete cascade,
  meals        jsonb not null default '[]'::jsonb,
  nap_from     time,
  nap_to       time,
  nap_slept    boolean,
  activities   text[] not null default '{}',
  mood         text check (mood is null or mood in ('happy','calm','sad','tired','sick')),
  note         text,
  published_at timestamptz,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (class_day_id, child_id)
);
create index daily_reports_child_idx on public.daily_reports (child_id, created_at desc);
create index daily_reports_day_idx on public.daily_reports (class_day_id, published_at);
create trigger daily_reports_updated_trg before update on public.daily_reports
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- صور الأطفال (من داخل النظام فقط) وربطها بالأطفال الظاهرين
-- ----------------------------------------------------------------------------
create table public.child_photos (
  id           uuid primary key default gen_random_uuid(),
  nursery_id   uuid not null references public.nurseries (id) on delete cascade,
  class_day_id uuid references public.class_days (id) on delete set null,
  storage_path text not null unique,  -- '<nursery_id>/<photo_id>.jpg'
  taken_by     uuid references auth.users (id),
  caption      text,
  created_at   timestamptz not null default now()
);
create index child_photos_nursery_idx on public.child_photos (nursery_id, created_at desc);

create table public.photo_children (
  photo_id   uuid not null references public.child_photos (id) on delete cascade,
  child_id   uuid not null references public.children (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, child_id)
);
create index photo_children_child_idx on public.photo_children (child_id);

-- ----------------------------------------------------------------------------
-- إعلانات الحضانة (تظهر في البوابات عند published_at)
-- ----------------------------------------------------------------------------
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  nursery_id   uuid not null references public.nurseries (id) on delete cascade,
  title        text not null,
  body         text not null,
  audience     announcement_audience not null default 'all',
  class_id     uuid references public.classes (id) on delete cascade,
  published_at timestamptz,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (audience = 'all' or class_id is not null)
);
create index announcements_nursery_idx on public.announcements (nursery_id, published_at desc);
create trigger announcements_updated_trg before update on public.announcements
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.child_health_profiles enable row level security;
create policy health_member_select on public.child_health_profiles for select
  using (public.is_nursery_member(nursery_id));
create policy health_manage_write on public.child_health_profiles for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy health_manage_update on public.child_health_profiles for update
  using (public.member_has_permission(nursery_id, 'can_manage_children'))
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));

alter table public.medication_schedules enable row level security;
create policy medication_member_select on public.medication_schedules for select
  using (public.is_nursery_member(nursery_id));
create policy medication_manage_write on public.medication_schedules for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy medication_manage_update on public.medication_schedules for update
  using (public.member_has_permission(nursery_id, 'can_manage_children'))
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy medication_manage_delete on public.medication_schedules for delete
  using (public.member_has_permission(nursery_id, 'can_manage_children'));

alter table public.daily_reports enable row level security;
create policy reports_member_select on public.daily_reports for select
  using (public.is_nursery_member(nursery_id));
create policy reports_manage_write on public.daily_reports for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_reports'));
create policy reports_manage_update on public.daily_reports for update
  using (public.member_has_permission(nursery_id, 'can_manage_reports'))
  with check (public.member_has_permission(nursery_id, 'can_manage_reports'));
create policy reports_manage_delete on public.daily_reports for delete
  using (public.member_has_permission(nursery_id, 'can_manage_reports'));

alter table public.child_photos enable row level security;
create policy photos_member_select on public.child_photos for select
  using (public.is_nursery_member(nursery_id));
create policy photos_manage_write on public.child_photos for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_photos'));
create policy photos_manage_delete on public.child_photos for delete
  using (public.member_has_permission(nursery_id, 'can_manage_photos'));

alter table public.photo_children enable row level security;
create policy photo_children_member_select on public.photo_children for select
  using (exists (select 1 from public.child_photos p
                 where p.id = photo_id and public.is_nursery_member(p.nursery_id)));
create policy photo_children_manage_write on public.photo_children for insert
  with check (exists (select 1 from public.child_photos p
                      where p.id = photo_id
                        and public.member_has_permission(p.nursery_id, 'can_manage_photos')));
create policy photo_children_manage_delete on public.photo_children for delete
  using (exists (select 1 from public.child_photos p
                 where p.id = photo_id
                   and public.member_has_permission(p.nursery_id, 'can_manage_photos')));

alter table public.announcements enable row level security;
create policy announcements_member_select on public.announcements for select
  using (public.is_nursery_member(nursery_id));
create policy announcements_manage_write on public.announcements for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_announcements'));
create policy announcements_manage_update on public.announcements for update
  using (public.member_has_permission(nursery_id, 'can_manage_announcements'))
  with check (public.member_has_permission(nursery_id, 'can_manage_announcements'));
create policy announcements_manage_delete on public.announcements for delete
  using (public.member_has_permission(nursery_id, 'can_manage_announcements'));

-- ----------------------------------------------------------------------------
-- تخزين صور الأطفال (bucket ‏child-media من 0001): أعضاء الحضانة فقط،
-- والمسار يبدأ بمعرّف الحضانة. البوابة لا تلمس التخزين مباشرة — روابط
-- موقعة يولّدها الخادم عبر RPC التوكن في 0006 (service role).
-- ----------------------------------------------------------------------------
create policy child_media_member_select on storage.objects for select
  using (bucket_id = 'child-media'
         and public.is_nursery_member(((storage.foldername(name))[1])::uuid));
create policy child_media_member_insert on storage.objects for insert
  with check (bucket_id = 'child-media'
              and public.member_has_permission(((storage.foldername(name))[1])::uuid, 'can_manage_photos'));
create policy child_media_member_delete on storage.objects for delete
  using (bucket_id = 'child-media'
         and public.member_has_permission(((storage.foldername(name))[1])::uuid, 'can_manage_photos'));

commit;
