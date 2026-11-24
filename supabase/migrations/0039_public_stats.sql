-- إحصاءات الصفحة العامة (مهمة 3.3 — نمط أرقام Hِlm): مشاهدات
-- ونقرات واتساب لكل حضانة. لا بيانات شخصية إطلاقاً: عدّادات
-- مجهولة (نوع + صفحة + وقت) — الكتابة عبر RPC فقط، والقراءة
-- للمالك وحده بـRLS.
create table public.public_page_events (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  kind text not null check (kind in ('view', 'whatsapp_click')),
  page text not null check (page in ('home', 'classes', 'about')),
  created_at timestamptz not null default now()
);
create index public_page_events_nursery_idx
  on public.public_page_events (nursery_id, created_at desc);
alter table public.public_page_events enable row level security;
create policy public_page_events_owner_read
  on public.public_page_events for select to authenticated
  using (public.is_nursery_owner(nursery_id));
grant select on public.public_page_events to authenticated;

create or replace function public.public_page_track(
  p_slug text, p_kind text, p_page text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_kind not in ('view', 'whatsapp_click') then return; end if;
  if p_page not in ('home', 'classes', 'about') then return; end if;
  select id into v_id from public.nurseries
  where public_slug = p_slug and public_enabled = true;
  if v_id is null then return; end if;
  insert into public.public_page_events (nursery_id, kind, page)
  values (v_id, p_kind, p_page);
end $$;
revoke execute on function public.public_page_track(text, text, text)
  from public;
grant execute on function public.public_page_track(text, text, text)
  to anon, authenticated;
