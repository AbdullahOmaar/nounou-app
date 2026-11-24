-- تصحيح 0045: دوال المنشورات استخدمت portal_token_resolve كأنها
-- تُرجع jsonb حالة — وهي تُرجع صف التوكن وترفع استثناء عند البطلان
-- (نمط البيت منذ 0030). إعادة بناء الدوال الثلاث على النمط الصحيح.
create or replace function public.nursery_portal_circulars_by_token(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tok public.guardian_access_tokens;
  v_rows jsonb;
begin
  tok := public.portal_token_resolve(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'body', a.body,
           'published_at', a.published_at,
           'wants_rsvp', a.wants_rsvp,
           'read', exists (
             select 1 from public.circular_reads r
             where r.announcement_id = a.id
               and r.guardian_id = tok.guardian_id),
           'my_rsvp', (
             select jsonb_build_object(
               'attending', x.attending, 'guests', x.guests)
             from public.circular_rsvps x
             where x.announcement_id = a.id
               and x.guardian_id = tok.guardian_id)
         ) order by a.published_at desc), '[]'::jsonb)
    into v_rows
  from public.announcements a
  where a.nursery_id = tok.nursery_id and a.published_at is not null;
  return jsonb_build_object('items', v_rows);
end $$;

create or replace function public.nursery_portal_mark_circular_read(
  p_token text, p_announcement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tok public.guardian_access_tokens;
begin
  tok := public.portal_token_resolve(p_token);
  insert into public.circular_reads (announcement_id, guardian_id)
  select p_announcement_id, tok.guardian_id
  where exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.nursery_id = tok.nursery_id
      and a.published_at is not null)
  on conflict do nothing;
  return jsonb_build_object('status', 'ok');
end $$;

create or replace function public.nursery_portal_circular_rsvp(
  p_token text, p_announcement_id uuid,
  p_attending boolean, p_guests integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tok public.guardian_access_tokens;
begin
  tok := public.portal_token_resolve(p_token);
  if coalesce(tok.access_scope, 'full') = 'view' then
    return jsonb_build_object('status', 'view_only');
  end if;
  insert into public.circular_rsvps
    (announcement_id, guardian_id, attending, guests, updated_at)
  select p_announcement_id, tok.guardian_id,
         p_attending, least(greatest(coalesce(p_guests, 0), 0), 20), now()
  where exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.nursery_id = tok.nursery_id
      and a.published_at is not null and a.wants_rsvp)
  on conflict (announcement_id, guardian_id)
  do update set attending = excluded.attending,
                guests = excluded.guests, updated_at = now();
  return jsonb_build_object('status', 'ok');
end $$;
