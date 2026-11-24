-- ملصقات موسمية (مهمة 3.13): الحضانة تختار ملصقاً مولّداً بقصّة
-- ملصق (حد أبيض) يُركَّب على أي لون في موقعها ودعواتها.
alter table public.nurseries
  add column sticker_key text
  check (sticker_key is null or sticker_key in
    ('lantern', 'balloons', 'cap', 'flower'));

create or replace function public.nursery_public_page(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.nurseries;
  v_classes jsonb;
begin
  select * into n from public.nurseries
  where public_slug = p_slug and public_enabled = true;
  if n.id is null then
    return jsonb_build_object('found', false);
  end if;
  select coalesce(jsonb_agg(c order by fee), '[]'::jsonb)
  into v_classes
  from (
    select jsonb_build_object(
      'name', cl.name,
      'fee', cl.monthly_fee,
      'capacity', cl.capacity,
      'available', case
        when cl.capacity is null then null
        else greatest(cl.capacity - count(e.id), 0)
      end
    ) as c, cl.monthly_fee as fee
    from public.classes cl
    left join public.enrollments e
      on e.class_id = cl.id and e.status = 'active'
    where cl.nursery_id = n.id and cl.archived_at is null
    group by cl.id, cl.name, cl.monthly_fee, cl.capacity
  ) x;
  return jsonb_build_object(
    'found', true,
    'name', n.name,
    'about', n.public_about,
    'address', n.address,
    'phone', n.phone,
    'logo_url', n.logo_url, 'brand_color', n.brand_color, 'banner_key', n.banner_key, 'sticker_key', n.sticker_key,
    'licensed', n.public_license_no is not null
      and char_length(btrim(n.public_license_no)) > 0,
    'payments', jsonb_build_object(
      'instapay', n.public_instapay,
      'vodafone', n.public_vodafone,
      'bank', n.public_bank
    ),
    'classes', v_classes
  );
end $$;
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
      'phone', v_n.phone, 'brand_color', v_n.brand_color, 'banner_key', v_n.banner_key
    )
  );
end $$;
revoke execute on function public.public_event_by_code(text) from public;
grant execute on function public.public_event_by_code(text)
  to anon, authenticated;

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
    'halls', coalesce(v_row.halls, '[]'::jsonb),
    'nursery', jsonb_build_object(
      'name', v_n.name, 'logo_url', v_n.logo_url,
      'phone', v_n.phone, 'brand_color', v_n.brand_color, 'banner_key', v_n.banner_key, 'sticker_key', v_n.sticker_key
    )
  );
end $$;
revoke execute on function public.public_event_by_code(text) from public;
grant execute on function public.public_event_by_code(text)
  to anon, authenticated;
