-- 4.21: أعلام ميزات لكل حضانة — التفعيل التدريجي الصريح.
-- القاعدة الصلبة: لا صف = مطفأ. لا تفعيل صامت أبداً؛ كل
-- تغيير علم يُسجل في سجل النشاط من الواجهة.

create table public.nursery_feature_flags (
  nursery_id uuid not null
    references public.nurseries(id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (nursery_id, flag_key)
);

alter table public.nursery_feature_flags enable row level security;

create policy feature_flags_owner_all on public.nursery_feature_flags
  for all to authenticated
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

grant select, insert, update on public.nursery_feature_flags
  to authenticated;
