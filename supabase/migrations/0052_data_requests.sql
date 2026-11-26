-- 4.13 (3A-437): نواة امتثال قانون حماية البيانات 151/2020 —
-- حقوق صاحب البيانات: ولي الأمر يطلب من بوابته تصدير بياناته
-- أو حذفها، والطلب يصل الحضانة بسجل متابَع. الحذف نفسه لا ينفذ
-- تلقائياً أبداً: قرار بشري موثق (فيه التزامات مالية/قانونية).

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  kind text not null check (kind in ('export','deletion')),
  status text not null default 'pending'
    check (status in ('pending','done','rejected')),
  created_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz
);

create index data_requests_nursery_idx
  on public.data_requests (nursery_id, status, created_at desc);

alter table public.data_requests enable row level security;

create policy data_requests_member_read on public.data_requests
  for select to authenticated
  using (public.is_nursery_member(nursery_id));

create policy data_requests_owner_update on public.data_requests
  for update to authenticated
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

grant select on public.data_requests to authenticated;
grant update (status, handled_by, handled_at)
  on public.data_requests to authenticated;

-- طلب جديد من البوابة (توكن كامل فقط) + قراءة طلباتي
create or replace function public.nursery_portal_data_request_by_token(
  p_token text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tok public.guardian_access_tokens;
begin
  tok := public.portal_token_resolve(p_token);
  if tok.access_scope = 'view' then
    return jsonb_build_object('status', 'view_only');
  end if;
  if p_kind not in ('export', 'deletion') then
    return jsonb_build_object('status', 'bad_kind');
  end if;
  insert into public.data_requests (nursery_id, guardian_id, kind)
  values (tok.nursery_id, tok.guardian_id, p_kind);
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.nursery_portal_my_data_requests_by_token(
  p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tok public.guardian_access_tokens;
  reqs jsonb;
begin
  tok := public.portal_token_resolve(p_token);
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', r.kind, 'status', r.status,
           'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    into reqs
    from public.data_requests r
   where r.nursery_id = tok.nursery_id and r.guardian_id = tok.guardian_id;
  return jsonb_build_object('status', 'ok', 'requests', reqs);
end;
$$;

revoke execute on function
  public.nursery_portal_data_request_by_token(text, text)
  from public;
revoke execute on function
  public.nursery_portal_my_data_requests_by_token(text)
  from public;
grant execute on function
  public.nursery_portal_data_request_by_token(text, text)
  to anon, authenticated;
grant execute on function
  public.nursery_portal_my_data_requests_by_token(text)
  to anon, authenticated;
