-- منصة مناسبات الحضانة (مهمة 3.9): تقويم مناسبات عام على موقع
-- الحضانة + أرشيف صور لكل حدث. الأرشيف في child-media وبصلاحيات
-- الأعضاء فقط — صور الأطفال لا تخرج للعموم أبداً (قاعدة المنتج:
-- الخروج بموافقة وعبر البوابة المحروسة فقط).
create or replace function public.public_nursery_events(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_events jsonb;
begin
  select id into v_id from public.nurseries
  where public_slug = p_slug and public_enabled = true;
  if v_id is null then
    return jsonb_build_object('found', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'title', e.title, 'kind', e.kind,
           'starts_at', e.starts_at, 'public_code', e.public_code,
           'location_text', e.location_text
         ) order by e.starts_at), '[]'::jsonb)
    into v_events
  from public.nursery_events e
  where e.nursery_id = v_id
    and e.starts_at > now() - interval '12 months';
  return jsonb_build_object('found', true, 'events', v_events);
end $$;
revoke execute on function public.public_nursery_events(text) from public;
grant execute on function public.public_nursery_events(text)
  to anon, authenticated;

create table public.event_photos (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  event_id uuid not null references public.nursery_events(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);
create index event_photos_event_idx
  on public.event_photos (event_id, created_at);
alter table public.event_photos enable row level security;
create policy event_photos_member_all
  on public.event_photos for all to authenticated
  using (public.is_nursery_member(nursery_id))
  with check (public.is_nursery_member(nursery_id));
grant select, insert, update, delete on public.event_photos
  to authenticated;
