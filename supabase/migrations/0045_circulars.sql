-- «ورق أم رابط» (مهمة 3.11): المنشور صفحة بوابة بتتبع قراءة
-- وRSVP بالاسم/العدد بدل الورقة الضائعة. + تقوية QA على قاعات
-- 3.8 (حد خادمي لعدد القاعات وشكل روابط الخرائط).
alter table public.announcements
  add column wants_rsvp boolean not null default false;

create table public.circular_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, guardian_id)
);
alter table public.circular_reads enable row level security;
create policy circular_reads_member_read
  on public.circular_reads for select to authenticated
  using (exists (
    select 1 from public.announcements a
    where a.id = announcement_id
      and public.is_nursery_member(a.nursery_id)
  ));
grant select on public.circular_reads to authenticated;

create table public.circular_rsvps (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  attending boolean not null,
  guests integer not null default 0 check (guests between 0 and 20),
  updated_at timestamptz not null default now(),
  primary key (announcement_id, guardian_id)
);
alter table public.circular_rsvps enable row level security;
create policy circular_rsvps_member_read
  on public.circular_rsvps for select to authenticated
  using (exists (
    select 1 from public.announcements a
    where a.id = announcement_id
      and public.is_nursery_member(a.nursery_id)
  ));
grant select on public.circular_rsvps to authenticated;

-- قاعات 3.8: تحقق خادمي (≤4 قاعات + روابط خرائط http(s) فقط)
create or replace function public.guard_event_halls()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  h jsonb;
begin
  if jsonb_array_length(coalesce(new.halls, '[]'::jsonb)) > 4 then
    raise exception 'too_many_halls';
  end if;
  for h in select value from jsonb_array_elements(coalesce(new.halls, '[]'::jsonb))
  loop
    if h ? 'maps_url' and h->>'maps_url' is not null
       and h->>'maps_url' !~ '^https?://' then
      raise exception 'bad_maps_url';
    end if;
  end loop;
  return new;
end $$;
create trigger nursery_events_halls_guard
  before insert or update of halls on public.nursery_events
  for each row execute function public.guard_event_halls();

-- واجهات البوابة: قائمة المنشورات بحالتها + تعليم القراءة + RSVP
create or replace function public.nursery_portal_circulars_by_token(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx jsonb := public.portal_token_resolve(p_token);
  v_nursery uuid := (v_ctx->>'nursery_id')::uuid;
  v_guardian uuid := (v_ctx->>'guardian_id')::uuid;
  v_rows jsonb;
begin
  if v_ctx->>'status' <> 'ok' then
    return jsonb_build_object('status', v_ctx->>'status');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'title', a.title, 'body', a.body,
           'published_at', a.published_at,
           'wants_rsvp', a.wants_rsvp,
           'read', exists (
             select 1 from public.circular_reads r
             where r.announcement_id = a.id and r.guardian_id = v_guardian),
           'my_rsvp', (
             select jsonb_build_object(
               'attending', x.attending, 'guests', x.guests)
             from public.circular_rsvps x
             where x.announcement_id = a.id and x.guardian_id = v_guardian)
         ) order by a.published_at desc), '[]'::jsonb)
    into v_rows
  from public.announcements a
  where a.nursery_id = v_nursery and a.published_at is not null;
  return jsonb_build_object('status', 'ok', 'items', v_rows);
end $$;
revoke execute on function public.nursery_portal_circulars_by_token(text)
  from public;
grant execute on function public.nursery_portal_circulars_by_token(text)
  to anon, authenticated;

create or replace function public.nursery_portal_mark_circular_read(
  p_token text, p_announcement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx jsonb := public.portal_token_resolve(p_token);
begin
  if v_ctx->>'status' <> 'ok' then
    return jsonb_build_object('status', v_ctx->>'status');
  end if;
  insert into public.circular_reads (announcement_id, guardian_id)
  select p_announcement_id, (v_ctx->>'guardian_id')::uuid
  where exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.nursery_id = (v_ctx->>'nursery_id')::uuid
      and a.published_at is not null)
  on conflict do nothing;
  return jsonb_build_object('status', 'ok');
end $$;
revoke execute on function public.nursery_portal_mark_circular_read(text, uuid)
  from public;
grant execute on function public.nursery_portal_mark_circular_read(text, uuid)
  to anon, authenticated;

create or replace function public.nursery_portal_circular_rsvp(
  p_token text, p_announcement_id uuid,
  p_attending boolean, p_guests integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ctx jsonb := public.portal_token_resolve(p_token);
begin
  if v_ctx->>'status' <> 'ok' then
    return jsonb_build_object('status', v_ctx->>'status');
  end if;
  if coalesce(v_ctx->>'access_scope', 'full') = 'view' then
    return jsonb_build_object('status', 'view_only');
  end if;
  insert into public.circular_rsvps
    (announcement_id, guardian_id, attending, guests, updated_at)
  select p_announcement_id, (v_ctx->>'guardian_id')::uuid,
         p_attending, least(greatest(coalesce(p_guests, 0), 0), 20), now()
  where exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.nursery_id = (v_ctx->>'nursery_id')::uuid
      and a.published_at is not null and a.wants_rsvp)
  on conflict (announcement_id, guardian_id)
  do update set attending = excluded.attending,
                guests = excluded.guests, updated_at = now();
  return jsonb_build_object('status', 'ok');
end $$;
revoke execute on function public.nursery_portal_circular_rsvp(
  text, uuid, boolean, integer) from public;
grant execute on function public.nursery_portal_circular_rsvp(
  text, uuid, boolean, integer) to anon, authenticated;
