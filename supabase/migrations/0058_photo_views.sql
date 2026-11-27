-- 4.14: سجل مشاهدات الصور — «بياناتك لا تُقرأ» قابلة للإثبات.
-- كل مشاهدة لصورة طفل (وصي عبر البوابة أو طاقم داخل التطبيق)
-- تُسجل: من ومتى. الوصي يرى سجل صور أطفاله من بوابته.
-- الكتابة عبر RPCs محروسة فقط — لا إدخال مباشر لأي عميل.

create table public.photo_views (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null
    references public.nurseries(id) on delete cascade,
  photo_id uuid not null
    references public.child_photos(id) on delete cascade,
  child_id uuid not null
    references public.children(id) on delete cascade,
  viewer_kind text not null check (viewer_kind in ('guardian', 'staff')),
  viewer_guardian_id uuid
    references public.guardians(id) on delete set null,
  viewer_user_id uuid,
  created_at timestamptz not null default now()
);

create index photo_views_child_idx
  on public.photo_views (child_id, created_at desc);

alter table public.photo_views enable row level security;

create policy photo_views_member_read on public.photo_views
  for select to authenticated
  using (public.is_nursery_member(nursery_id));

grant select on public.photo_views to authenticated;

-- مشاهدة وصي: تُستدعى من Edge Function ‏portal-media بعد نجاح
-- التوقيع (الخادم هو نقطة المشاهدة الحقيقية). الرابط بالطفل
-- شرط: لا سجل لصورة لا تخص أطفال هذا الوصي.
create or replace function public.log_portal_photo_view(
  p_token text,
  p_photo_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tok public.guardian_access_tokens;
  v_child uuid;
begin
  tok := public.portal_token_resolve(p_token);
  select pc.child_id into v_child
  from public.photo_children pc
  join public.guardian_children gc on gc.child_id = pc.child_id
  where pc.photo_id = p_photo_id
    and gc.guardian_id = tok.guardian_id
  limit 1;
  if v_child is null then
    return jsonb_build_object('status', 'not_linked');
  end if;
  insert into public.photo_views
    (nursery_id, photo_id, child_id, viewer_kind, viewer_guardian_id)
  values
    (tok.nursery_id, p_photo_id, v_child, 'guardian', tok.guardian_id);
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke execute on function public.log_portal_photo_view(text, uuid)
  from public;
grant execute on function public.log_portal_photo_view(text, uuid)
  to anon, authenticated;

-- مشاهدات الطاقم دفعة واحدة: تُستدعى من التطبيق عند جلب صور
-- طفل (العرض داخل التطبيق هو المشاهدة). العضوية شرط صريح.
create or replace function public.log_staff_photo_views(
  p_photo_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int := 0;
  rec record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  for rec in
    select cp.id as photo_id, cp.nursery_id, pc.child_id
    from public.child_photos cp
    join public.photo_children pc on pc.photo_id = cp.id
    where cp.id = any (p_photo_ids)
      and public.is_nursery_member(cp.nursery_id)
  loop
    insert into public.photo_views
      (nursery_id, photo_id, child_id, viewer_kind, viewer_user_id)
    values
      (rec.nursery_id, rec.photo_id, rec.child_id, 'staff', v_uid);
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('status', 'ok', 'logged', v_count);
end;
$$;

revoke execute on function public.log_staff_photo_views(uuid[])
  from public;
grant execute on function public.log_staff_photo_views(uuid[])
  to authenticated;

-- قراءة الوصي: مشاهدات صور أطفاله (آخر 50).
create or replace function public.nursery_portal_photo_views_by_token(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tok public.guardian_access_tokens;
  v_rows jsonb;
begin
  tok := public.portal_token_resolve(p_token);
  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) into v_rows
  from (
    select pv.viewer_kind,
           (pv.viewer_guardian_id = tok.guardian_id) as is_self,
           pv.created_at,
           c.full_name as child_name
    from public.photo_views pv
    join public.children c on c.id = pv.child_id
    join public.guardian_children gc
      on gc.child_id = pv.child_id
     and gc.guardian_id = tok.guardian_id
    order by pv.created_at desc
    limit 50
  ) r;
  return jsonb_build_object('status', 'ok', 'views', v_rows);
end;
$$;

revoke execute on function
  public.nursery_portal_photo_views_by_token(text) from public;
grant execute on function
  public.nursery_portal_photo_views_by_token(text)
  to anon, authenticated;
