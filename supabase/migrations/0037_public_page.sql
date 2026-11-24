-- صفحة الحضانة العامة (مهمة 3.1): اكتشاف علني مولّد من بيانات
-- الحضانة نفسها — بلا أي بيانات أطفال أو أوصياء. التفعيل اختياري
-- صراحةً من المالك، والقراءة العامة عبر RPC آمنة فقط.
alter table public.nurseries
  add column public_slug text unique,
  add column public_enabled boolean not null default false,
  add column public_about text,
  add column public_license_no text;

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
    'logo_url', n.logo_url,
    'licensed', n.public_license_no is not null
      and char_length(btrim(n.public_license_no)) > 0,
    'classes', v_classes
  );
end $$;
revoke execute on function public.nursery_public_page(text) from public;
grant execute on function public.nursery_public_page(text)
  to anon, authenticated;
