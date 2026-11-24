-- هوية الحضانة (مهمة 3.4): لون علامة + شعار علني — يظهران على
-- الصفحة العامة والبوابة والوثائق المطبوعة. الشعار في bucket
-- علني مخصص (الشعار بطبيعته علني)، والرفع لأعضاء الحضانة فقط
-- عبر سياسات كائنات مقيدة بمجلد الحضانة.
alter table public.nurseries
  add column brand_color text
  check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nursery-logos', 'nursery-logos', true, 2097152,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy nursery_logos_public_read
  on storage.objects for select
  using (bucket_id = 'nursery-logos');
create policy nursery_logos_member_write
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nursery-logos'
    and public.is_nursery_member(
      ((storage.foldername(name))[1])::uuid
    )
  );
create policy nursery_logos_member_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nursery-logos'
    and public.is_nursery_member(
      ((storage.foldername(name))[1])::uuid
    )
  );

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
    'logo_url', n.logo_url, 'brand_color', n.brand_color,
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
revoke execute on function public.nursery_public_page(text) from public;
grant execute on function public.nursery_public_page(text)
  to anon, authenticated;

CREATE OR REPLACE FUNCTION public.nursery_portal_overview_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  tok public.guardian_access_tokens;
  v_children jsonb;
  v_announcements jsonb;
begin
  tok := public.portal_token_resolve(p_token);

  select coalesce(jsonb_agg(child_obj order by child_name), '[]'::jsonb)
  into v_children
  from (
    select
      c.full_name as child_name,
      jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'photo_consent', c.photo_consent,
        'class_name', cl.name,
        'balance', coalesce(cb.balance, 0),
        'total_paid', coalesce(cb.total_paid, 0)
      ) as child_obj
    from public.guardian_children gc
    join public.children c on c.id = gc.child_id and c.archived_at is null
    left join public.enrollments e on e.child_id = c.id and e.status = 'active'
    left join public.classes cl on cl.id = e.class_id
    left join public.child_balances cb on cb.child_id = c.id
    where gc.guardian_id = tok.guardian_id
      and (tok.child_id is null or tok.child_id = c.id)
  ) s;

  select coalesce(jsonb_agg(a order by published_at desc), '[]'::jsonb)
  into v_announcements
  from (
    select jsonb_build_object(
      'id', an.id, 'title', an.title, 'body', an.body, 'published_at', an.published_at
    ) as a, an.published_at
    from public.announcements an
    where an.nursery_id = tok.nursery_id and an.published_at is not null
    order by an.published_at desc
    limit 10
  ) s;

  return jsonb_build_object(
    'access_scope', tok.access_scope,
    'nursery', (select jsonb_build_object('name', n.name, 'logo_url', n.logo_url, 'brand_color', n.brand_color, 'phone', n.phone)
                from public.nurseries n where n.id = tok.nursery_id),
    'guardian', (select jsonb_build_object('full_name', g.full_name)
                 from public.guardians g where g.id = tok.guardian_id),
    'children', v_children,
    'announcements', v_announcements
  );
end $function$
