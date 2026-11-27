-- 0060: تتبع الباص الحي (3A-414)
-- جلسة بث لكل قائمة يوم: المشرفة تبدأ/تنهي البث صراحة، والموقع الأخير فقط
-- يُحفظ في صف الجلسة نفسه (يُستبدل مع كل تحديث) — لا سجل مواقع دائم،
-- والأثر المحفوظ الوحيد هو حدثا البدء/الإنهاء طبقاً لنطاق خصوصية البند.
-- ولي الأمر يرى الموقع عبر دالة بوابة محروسة بالتوكن فقط، ولأطفال هذا التشغيل فقط.

create table public.bus_live_sessions (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  route_id    uuid not null references public.bus_routes (id) on delete cascade,
  list_id     uuid not null references public.bus_day_lists (id) on delete cascade,
  direction   public.bus_direction not null,
  started_by  uuid references public.nursery_members (id) on delete set null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  last_lat    double precision,
  last_lng    double precision,
  last_loc_at timestamptz,
  created_at  timestamptz not null default now()
);

-- جلسة نشطة واحدة كحد أقصى لكل قائمة يوم
create unique index bus_live_one_active_per_list
  on public.bus_live_sessions (list_id) where ended_at is null;
create index bus_live_nursery_idx on public.bus_live_sessions (nursery_id, started_at desc);

alter table public.bus_live_sessions enable row level security;

-- القراءة لأعضاء الحضانة فقط (واجهة الطاقم)؛ الكتابة عبر الدوال المحروسة فقط
create policy bus_live_member_select on public.bus_live_sessions for select
  using (public.is_nursery_member(nursery_id));

grant select on public.bus_live_sessions to authenticated;

-- ----------------------------------------------------------------------------
-- بدء البث على قائمة اليوم (صاحب صلاحية إدارة الباص فقط)
-- ----------------------------------------------------------------------------
create or replace function public.bus_live_start(p_list_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_list public.bus_day_lists;
  v_session public.bus_live_sessions;
  v_member uuid;
begin
  select * into v_list from public.bus_day_lists where id = p_list_id;
  if not found then
    raise exception 'list_not_found';
  end if;
  if auth.uid() is null
     or not public.member_has_permission(v_list.nursery_id, 'can_manage_bus') then
    raise exception 'forbidden';
  end if;
  if v_list.day_date <> (now() at time zone 'Africa/Cairo')::date then
    raise exception 'list_not_today';
  end if;

  select * into v_session
  from public.bus_live_sessions
  where list_id = p_list_id and ended_at is null;
  if found then
    return to_jsonb(v_session);
  end if;

  select id into v_member
  from public.nursery_members
  where nursery_id = v_list.nursery_id and user_id = auth.uid();

  insert into public.bus_live_sessions
    (nursery_id, route_id, list_id, direction, started_by)
  values
    (v_list.nursery_id, v_list.route_id, v_list.id, v_list.direction, v_member)
  returning * into v_session;
  return to_jsonb(v_session);
end $$;

-- ----------------------------------------------------------------------------
-- تحديث الموقع الأخير (يستبدل السابق — لا تراكم)
-- ----------------------------------------------------------------------------
create or replace function public.bus_live_update(
  p_session_id uuid, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_session public.bus_live_sessions;
begin
  select * into v_session from public.bus_live_sessions where id = p_session_id;
  if not found then
    raise exception 'session_not_found';
  end if;
  if auth.uid() is null
     or not public.member_has_permission(v_session.nursery_id, 'can_manage_bus') then
    raise exception 'forbidden';
  end if;
  if v_session.ended_at is not null then
    raise exception 'session_ended';
  end if;
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coords';
  end if;

  update public.bus_live_sessions
  set last_lat = p_lat, last_lng = p_lng, last_loc_at = now()
  where id = p_session_id
  returning * into v_session;
  return to_jsonb(v_session);
end $$;

-- ----------------------------------------------------------------------------
-- إنهاء البث صراحة
-- ----------------------------------------------------------------------------
create or replace function public.bus_live_end(p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_session public.bus_live_sessions;
begin
  select * into v_session from public.bus_live_sessions where id = p_session_id;
  if not found then
    raise exception 'session_not_found';
  end if;
  if auth.uid() is null
     or not public.member_has_permission(v_session.nursery_id, 'can_manage_bus') then
    raise exception 'forbidden';
  end if;

  update public.bus_live_sessions
  set ended_at = now()
  where id = p_session_id and ended_at is null
  returning * into v_session;
  if not found then
    select * into v_session from public.bus_live_sessions where id = p_session_id;
  end if;
  return to_jsonb(v_session);
end $$;

-- ----------------------------------------------------------------------------
-- بوابة ولي الأمر: موقع الباص الحي لتشغيل يضم طفلاً يغطيه التوكن فقط.
-- يعيد found=false عند غياب أي تشغيل نشط لطفل الوصي.
-- ----------------------------------------------------------------------------
create or replace function public.portal_bus_live(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
  v_row record;
begin
  tok := public.portal_token_resolve(p_token);

  select s.id, s.direction, s.started_at, s.last_lat, s.last_lng, s.last_loc_at,
         r.name as route_name
  into v_row
  from public.bus_live_sessions s
  join public.bus_routes r on r.id = s.route_id
  where s.ended_at is null
    and s.nursery_id = tok.nursery_id
    and exists (
      select 1
      from public.bus_day_entries e
      join public.guardian_children gc on gc.child_id = e.child_id
      where e.list_id = s.list_id
        and gc.guardian_id = tok.guardian_id
        and (tok.child_id is null or tok.child_id = e.child_id)
        and e.status <> 'absent'
    )
  order by s.started_at desc
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'route_name', v_row.route_name,
    'direction', v_row.direction,
    'started_at', v_row.started_at,
    'lat', v_row.last_lat,
    'lng', v_row.last_lng,
    'loc_at', v_row.last_loc_at
  );
end $$;

grant execute on function public.bus_live_start(uuid) to authenticated;
grant execute on function public.bus_live_update(uuid, double precision, double precision)
  to authenticated;
grant execute on function public.bus_live_end(uuid) to authenticated;
grant execute on function public.portal_bus_live(text) to anon, authenticated;
