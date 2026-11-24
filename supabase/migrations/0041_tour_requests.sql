-- حجز جولة إلكتروني (مهمة 3.6 — بند 674): زائر الصفحة العامة
-- يحجز زيارة، والطلب يصل الطاقم ويتحول لتسجيل فعلي بضغطة.
-- الإدراج العام عبر RPC فقط (حضانة مفعّلة + تحقق أطوال)، والقراءة
-- والإدارة للأعضاء بـRLS.
create table public.tour_requests (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  parent_name text not null,
  parent_phone text not null,
  child_name text not null,
  preferred_at timestamptz,
  note text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'done', 'converted')),
  converted_child_id uuid references public.children(id) on delete set null,
  created_at timestamptz not null default now()
);
create index tour_requests_nursery_idx
  on public.tour_requests (nursery_id, created_at desc);
alter table public.tour_requests enable row level security;
create policy tour_requests_member_all
  on public.tour_requests for all to authenticated
  using (public.is_nursery_member(nursery_id))
  with check (public.is_nursery_member(nursery_id));
grant select, insert, update, delete on public.tour_requests
  to authenticated;

create or replace function public.public_book_tour(
  p_slug text, p_parent_name text, p_parent_phone text,
  p_child_name text, p_preferred_at timestamptz, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.nurseries
  where public_slug = p_slug and public_enabled = true;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if char_length(btrim(p_parent_name)) < 2
     or char_length(btrim(p_child_name)) < 2
     or char_length(regexp_replace(p_parent_phone, '[^0-9]', '', 'g'))
        not between 8 and 15 then
    return jsonb_build_object('ok', false, 'error', 'bad_input');
  end if;
  insert into public.tour_requests
    (nursery_id, parent_name, parent_phone, child_name,
     preferred_at, note)
  values
    (v_id, btrim(p_parent_name), btrim(p_parent_phone),
     btrim(p_child_name), p_preferred_at,
     nullif(btrim(coalesce(p_note, '')), ''));
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.public_book_tour(
  text, text, text, text, timestamptz, text) from public;
grant execute on function public.public_book_tour(
  text, text, text, text, timestamptz, text) to anon, authenticated;
