-- منشورات الصفحة العامة (3A-891 — شريحة المحتوى الدوري، الجزء
-- داخل التطبيق): الحضانة تجهّز منشورات دورية (أخبار/نصائح/تهاني)
-- من داخل التطبيق وتنشرها على صفحتها العامة نفسها. النشر على
-- الحساب الاجتماعي الخارجي خطوة منفصلة واقفة على قرار المالك
-- (فك تجميد الحساب) — ليست هنا.
-- الكتابة: المالك أو عضو بصلاحية can_manage_announcements.
-- القراءة العامة: عبر nursery_public_page فقط (المنشورة فقط) —
-- لا منحة قراءة مباشرة لـ anon على الجدول.

create table public.public_posts (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  title text not null,
  body text not null,
  image_key text,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index public_posts_nursery_idx
  on public.public_posts (nursery_id, status, published_at desc);

alter table public.public_posts enable row level security;

create policy public_posts_member_select on public.public_posts for select
  to authenticated
  using (public.is_nursery_member(nursery_id));

create policy public_posts_manage_insert on public.public_posts for insert
  to authenticated
  with check (public.member_has_permission(nursery_id, 'can_manage_announcements'));

create policy public_posts_manage_update on public.public_posts for update
  to authenticated
  using (public.member_has_permission(nursery_id, 'can_manage_announcements'))
  with check (public.member_has_permission(nursery_id, 'can_manage_announcements'));

create policy public_posts_manage_delete on public.public_posts for delete
  to authenticated
  using (public.member_has_permission(nursery_id, 'can_manage_announcements'));

grant select, insert, update, delete on public.public_posts to authenticated;

-- توسيع RPC الصفحة العامة بالمنشورات المنشورة (أحدث أولاً، 10
-- كحد أقصى) — التعريف مبني على الحي الحالي + قسم المنشورات.
create or replace function public.nursery_public_page(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.nurseries;
  v_classes jsonb;
  v_posts jsonb;
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
  select coalesce(jsonb_agg(p order by published_at desc), '[]'::jsonb)
  into v_posts
  from (
    select jsonb_build_object(
      'title', pp.title,
      'body', pp.body,
      'image_key', pp.image_key,
      'published_at', pp.published_at
    ) as p, pp.published_at as published_at
    from public.public_posts pp
    where pp.nursery_id = n.id and pp.status = 'published'
    order by pp.published_at desc nulls last, pp.created_at desc
    limit 10
  ) y;
  return jsonb_build_object(
    'found', true,
    'name', n.name,
    'about', n.public_about,
    'address', n.address,
    'phone', n.phone,
    'logo_url', n.logo_url,
    'brand_color', n.brand_color,
    'banner_key', n.banner_key,
    'sticker_key', n.sticker_key,
    'licensed', n.public_license_no is not null
      and char_length(btrim(n.public_license_no)) > 0,
    'payments', jsonb_build_object(
      'instapay', n.public_instapay,
      'vodafone', n.public_vodafone,
      'bank', n.public_bank
    ),
    'classes', v_classes,
    'posts', v_posts
  );
end $$;

revoke execute on function public.nursery_public_page(text) from public;
grant execute on function public.nursery_public_page(text)
  to anon, authenticated;
