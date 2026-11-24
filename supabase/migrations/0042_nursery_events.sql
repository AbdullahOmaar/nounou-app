-- دعوات مناسبات الحضانة برابط (مهمة 3.7): حدث برابط عام قصير —
-- صفحة دعوة فيها الخريطة وإضافة للتقويم وRSVP واتساب.
-- بيانات الحدث علنية بطبيعتها (الدعوة نفسها)، والقراءة العامة
-- عبر RPC بالكود فقط.
create table public.nursery_events (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  title text not null,
  kind text not null default 'other'
    check (kind in ('graduation', 'open_day', 'aqeeqa', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location_text text,
  maps_url text,
  public_code text not null unique
    default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index nursery_events_nursery_idx
  on public.nursery_events (nursery_id, starts_at desc);
alter table public.nursery_events enable row level security;
create policy nursery_events_member_all
  on public.nursery_events for all to authenticated
  using (public.is_nursery_member(nursery_id))
  with check (public.is_nursery_member(nursery_id));
grant select, insert, update, delete on public.nursery_events
  to authenticated;

create or replace function public.public_event_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.nursery_events%rowtype;
  v_n public.nurseries%rowtype;
begin
  select * into v_row from public.nursery_events
  where public_code = p_code;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into v_n from public.nurseries where id = v_row.nursery_id;
  return jsonb_build_object(
    'found', true,
    'title', v_row.title,
    'kind', v_row.kind,
    'starts_at', v_row.starts_at,
    'ends_at', v_row.ends_at,
    'location_text', v_row.location_text,
    'maps_url', v_row.maps_url,
    'nursery', jsonb_build_object(
      'name', v_n.name, 'logo_url', v_n.logo_url,
      'phone', v_n.phone, 'brand_color', v_n.brand_color
    )
  );
end $$;
revoke execute on function public.public_event_by_code(text) from public;
grant execute on function public.public_event_by_code(text)
  to anon, authenticated;
