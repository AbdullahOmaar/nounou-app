-- جلسات أسئلة مباشرة مع الأهالي (مهمة 2.8، فوق إشعارات 2.1):
-- الحضانة تعلن جلسة، الأهالي يسألون بالتوكن، والسؤال يبقى خاصاً
-- حتى يُجاب فيصير منشوراً لكل أهالي الحضانة.
create table public.qa_sessions (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'ended')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index qa_sessions_nursery_idx
  on public.qa_sessions (nursery_id, starts_at desc);
alter table public.qa_sessions enable row level security;
create policy qa_sessions_member_all on public.qa_sessions
  for all
  using (public.is_nursery_member(nursery_id))
  with check (public.is_nursery_member(nursery_id));

create table public.qa_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.qa_sessions (id) on delete cascade,
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  answer text,
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index qa_questions_session_idx
  on public.qa_questions (session_id, created_at);
alter table public.qa_questions enable row level security;
create policy qa_questions_member_all on public.qa_questions
  for all
  using (public.is_nursery_member(nursery_id))
  with check (public.is_nursery_member(nursery_id));

-- نوع إشعار جديد للجرس
alter table public.guardian_notifications
  drop constraint guardian_notifications_kind_check;
alter table public.guardian_notifications
  add constraint guardian_notifications_kind_check
  check (kind in ('report', 'proof_approved', 'proof_rejected', 'invoice',
                  'announcement', 'message', 'qa'));

-- إشعار كل الأوصياء عند إنشاء جلسة
create or replace function public.qa_sessions_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_guardian_notification(
    new.nursery_id, null, null, 'qa',
    jsonb_build_object('title', new.title));
  return new;
end $$;
create trigger qa_sessions_notify_trg
  after insert on public.qa_sessions
  for each row execute function public.qa_sessions_notify();

-- قراءة البوابة: الجلسات القادمة/الحية + الأسئلة المنشورة + أسئلتي
create or replace function public.nursery_portal_qa_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tok public.guardian_access_tokens;
  v_sessions jsonb;
begin
  tok := public.portal_token_resolve(p_token);
  select coalesce(jsonb_agg(s order by starts_at), '[]'::jsonb)
  into v_sessions
  from (
    select jsonb_build_object(
      'id', qs.id,
      'title', qs.title,
      'starts_at', qs.starts_at,
      'status', qs.status,
      'published', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', q.id, 'body', q.body, 'answer', q.answer,
          'answered_at', q.answered_at) order by q.answered_at)
        from public.qa_questions q
        where q.session_id = qs.id and q.answer is not null
      ), '[]'::jsonb),
      'mine', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', q.id, 'body', q.body, 'answer', q.answer,
          'created_at', q.created_at) order by q.created_at)
        from public.qa_questions q
        where q.session_id = qs.id and q.guardian_id = tok.guardian_id
      ), '[]'::jsonb)
    ) as s, qs.starts_at
    from public.qa_sessions qs
    where qs.nursery_id = tok.nursery_id and qs.status in ('scheduled', 'live')
  ) x;
  return jsonb_build_object('sessions', v_sessions);
end $$;
revoke execute on function public.nursery_portal_qa_by_token(text)
  from public;
grant execute on function public.nursery_portal_qa_by_token(text)
  to anon, authenticated;

-- سؤال بالتوكن (توكن المشاهدة محظور — 2.7)
create or replace function public.nursery_portal_ask_by_token(
  p_token text, p_session uuid, p_body text
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
  if tok.access_scope = 'view' then raise exception 'view_only'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0
     or char_length(p_body) > 1000 then
    raise exception 'bad_body';
  end if;
  if not exists (
    select 1 from public.qa_sessions qs
    where qs.id = p_session and qs.nursery_id = tok.nursery_id
      and qs.status in ('scheduled', 'live')
  ) then
    raise exception 'session_not_open';
  end if;
  insert into public.qa_questions (session_id, nursery_id, guardian_id, body)
  values (p_session, tok.nursery_id, tok.guardian_id, btrim(p_body))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.nursery_portal_ask_by_token(text, uuid, text)
  from public;
grant execute on function public.nursery_portal_ask_by_token(text, uuid, text)
  to anon, authenticated;
