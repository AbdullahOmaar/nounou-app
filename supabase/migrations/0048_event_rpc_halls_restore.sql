-- تصحيح 0047: إعادة بناء public_event_by_code سقط منها حقل
-- القاعات (أضافته 0043) لأنها بُنيت من نص 0042. هذه من نص 0043
-- الحي + banner_key.
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
      'phone', v_n.phone, 'brand_color', v_n.brand_color, 'banner_key', v_n.banner_key
    )
  );
end $$;
revoke execute on function public.public_event_by_code(text) from public;
grant execute on function public.public_event_by_code(text)
  to anon, authenticated;
