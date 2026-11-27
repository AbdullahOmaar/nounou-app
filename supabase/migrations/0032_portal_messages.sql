-- رسائل الأهالي داخل البوابة (مهمة 2.5 / 3A-411): خيط واحد لكل
-- وصيّ داخل حضانته. الوصيّ يكتب ويقرأ عبر RPCs بالتوكن فقط؛
-- الطاقم عبر RLS (أعضاء الحضانة). رد الطاقم يولّد إشعار جرس.
create table public.portal_messages (
  id                 uuid primary key default gen_random_uuid(),
  nursery_id         uuid not null references public.nurseries (id) on delete cascade,
  guardian_id        uuid not null references public.guardians (id) on delete cascade,
  sender             text not null check (sender in ('guardian', 'staff')),
  body               text not null check (char_length(body) between 1 and 2000),
  read_by_staff_at   timestamptz,
  read_by_guardian_at timestamptz,
  created_at         timestamptz not null default now()
);
create index portal_messages_thread_idx
  on public.portal_messages (nursery_id, guardian_id, created_at);
alter table public.portal_messages enable row level security;
create policy portal_messages_member_select on public.portal_messages
  for select using (public.is_nursery_member(nursery_id));
create policy portal_messages_member_insert on public.portal_messages
  for insert with check (
    public.is_nursery_member(nursery_id) and sender = 'staff'
  );
create policy portal_messages_member_update on public.portal_messages
  for update using (public.is_nursery_member(nursery_id))
  with check (public.is_nursery_member(nursery_id));

-- نوع إشعار جديد في الجرس: رسالة من الحضانة
alter table public.guardian_notifications
  drop constraint guardian_notifications_kind_check;
alter table public.guardian_notifications
  add constraint guardian_notifications_kind_check
  check (kind in ('report', 'proof_approved', 'proof_rejected',
                  'invoice', 'announcement', 'message'));

create or replace function public.portal_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.sender = 'staff' then
    perform public.emit_guardian_notification(
      new.nursery_id, null, new.guardian_id, 'message', '{}'::jsonb);
  end if;
  return new;
end $$;
create trigger portal_messages_notify_trg
  after insert on public.portal_messages
  for each row execute function public.portal_messages_notify();

-- قراءة خيط الوصيّ بالتوكن (آخر 100 رسالة، الأقدم أولاً للعرض)
create or replace function public.nursery_portal_messages_by_token(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tok public.guardian_access_tokens;
  v_items jsonb;
begin
  tok := public.portal_token_resolve(p_token);
  update public.portal_messages
  set read_by_guardian_at = now()
  where nursery_id = tok.nursery_id and guardian_id = tok.guardian_id
    and sender = 'staff' and read_by_guardian_at is null;
  select coalesce(jsonb_agg(m order by created_at), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', pm.id, 'sender', pm.sender, 'body', pm.body,
      'created_at', pm.created_at
    ) as m, pm.created_at
    from public.portal_messages pm
    where pm.nursery_id = tok.nursery_id and pm.guardian_id = tok.guardian_id
    order by pm.created_at desc
    limit 100
  ) s;
  return jsonb_build_object('items', v_items);
end $$;

-- إرسال رسالة من الوصيّ بالتوكن
create or replace function public.nursery_portal_send_message_by_token(
  p_token text, p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tok public.guardian_access_tokens;
  v_id uuid;
begin
  tok := public.portal_token_resolve(p_token);
  if p_body is null or char_length(trim(p_body)) = 0
     or char_length(p_body) > 2000 then
    raise exception 'bad_body';
  end if;
  insert into public.portal_messages (nursery_id, guardian_id, sender, body)
  values (tok.nursery_id, tok.guardian_id, 'guardian', trim(p_body))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.nursery_portal_messages_by_token(text)
  from public;
revoke execute on function public.nursery_portal_send_message_by_token(text, text)
  from public;
grant execute on function public.nursery_portal_messages_by_token(text)
  to anon, authenticated;
grant execute on function public.nursery_portal_send_message_by_token(text, text)
  to anon, authenticated;
