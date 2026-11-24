-- مصفوفة إشعارات بلا واتساب API (مهمة 2.1): جرس بوابة ولي الأمر.
-- إشعارات مخزّنة لكل وصيّ تُولّدها مشغّلات من مصدر الحقيقة نفسه
-- (نشر تقرير / قرار إثبات / إصدار فاتورة / إعلان منشور) — النص
-- يُركَّب في العميل من kind+meta عبر القاموس (ثنائي اللغة)، فلا
-- لغة مخزّنة. القراءة والتعليم كمقروء عبر RPC بالتوكن فقط.
create table public.guardian_notifications (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  child_id    uuid references public.children (id) on delete cascade,
  kind        text not null check (kind in
                ('report', 'proof_approved', 'proof_rejected', 'invoice',
                 'announcement')),
  meta        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index guardian_notifications_inbox_idx
  on public.guardian_notifications (guardian_id, read_at, created_at desc);

alter table public.guardian_notifications enable row level security;
-- قراءة دعم فقط لأعضاء الحضانة؛ الكتابة للمشغّلات (security definer)
create policy guardian_notifications_member_read
  on public.guardian_notifications for select
  using (public.is_nursery_member(nursery_id));

-- مولّد داخلي: إشعار لكل أوصياء طفل (أو وصيّ واحد محدد)
create or replace function public.emit_guardian_notification(
  p_nursery uuid, p_child uuid, p_guardian uuid,
  p_kind text, p_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_guardian is not null then
    insert into public.guardian_notifications
      (nursery_id, guardian_id, child_id, kind, meta)
    values (p_nursery, p_guardian, p_child, p_kind, p_meta);
  elsif p_child is not null then
    insert into public.guardian_notifications
      (nursery_id, guardian_id, child_id, kind, meta)
    select p_nursery, gc.guardian_id, p_child, p_kind, p_meta
    from public.guardian_children gc
    where gc.child_id = p_child;
  else
    insert into public.guardian_notifications
      (nursery_id, guardian_id, child_id, kind, meta)
    select distinct p_nursery, gc.guardian_id, null, p_kind, p_meta
    from public.guardian_children gc
    join public.children c on c.id = gc.child_id
    where c.nursery_id = p_nursery;
  end if;
end $$;
revoke execute on function
  public.emit_guardian_notification(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;

-- تقرير نُشر
create or replace function public.notify_on_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null) then
    perform public.emit_guardian_notification(
      new.nursery_id, new.child_id, null, 'report',
      jsonb_build_object('child_id', new.child_id));
  end if;
  return new;
end $$;
create trigger daily_reports_notify_trg
  after insert or update of published_at on public.daily_reports
  for each row execute function public.notify_on_report();

-- قرار إثبات دفع من البوابة
create or replace function public.notify_on_proof()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.proof_status = 'pending'
     and new.proof_status in ('approved', 'rejected') then
    perform public.emit_guardian_notification(
      new.nursery_id, new.child_id, new.guardian_id,
      case when new.proof_status = 'approved'
           then 'proof_approved' else 'proof_rejected' end,
      jsonb_build_object('amount', new.amount, 'child_id', new.child_id,
                         'reason', new.rejection_reason));
  end if;
  return new;
end $$;
create trigger payments_proof_notify_trg
  after update of proof_status on public.payments
  for each row execute function public.notify_on_proof();

-- فاتورة أُصدرت
create or replace function public.notify_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'issued' then
    perform public.emit_guardian_notification(
      new.nursery_id, new.child_id, null, 'invoice',
      jsonb_build_object('period', new.period, 'child_id', new.child_id));
  end if;
  return new;
end $$;
create trigger invoices_notify_trg
  after insert on public.invoices
  for each row execute function public.notify_on_invoice();

-- إعلان نُشر (لكل الحضانة أو لفصل — عبر أطفال الفصل)
create or replace function public.notify_on_announcement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null) then
    if new.class_id is null then
      perform public.emit_guardian_notification(
        new.nursery_id, null, null, 'announcement',
        jsonb_build_object('title', new.title));
    else
      insert into public.guardian_notifications
        (nursery_id, guardian_id, child_id, kind, meta)
      select distinct new.nursery_id, gc.guardian_id, gc.child_id,
             'announcement', jsonb_build_object('title', new.title)
      from public.enrollments e
      join public.guardian_children gc on gc.child_id = e.child_id
      where e.class_id = new.class_id and e.status = 'active';
    end if;
  end if;
  return new;
end $$;
create trigger announcements_notify_trg
  after insert or update of published_at on public.announcements
  for each row execute function public.notify_on_announcement();

-- قراءة صندوق الوصيّ بالتوكن
create or replace function public.nursery_portal_notifications_by_token(
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
  v_unread int;
begin
  tok := public.portal_token_resolve(p_token);
  select coalesce(jsonb_agg(n order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', gn.id, 'kind', gn.kind, 'meta', gn.meta,
      'child_id', gn.child_id, 'created_at', gn.created_at,
      'read_at', gn.read_at
    ) as n, gn.created_at
    from public.guardian_notifications gn
    where gn.guardian_id = tok.guardian_id
      and gn.nursery_id = tok.nursery_id
    order by gn.created_at desc
    limit 30
  ) s;
  select count(*) into v_unread
  from public.guardian_notifications
  where guardian_id = tok.guardian_id and read_at is null;
  return jsonb_build_object('unread', v_unread, 'items', v_items);
end $$;

-- تعليم الكل كمقروء بالتوكن
create or replace function public.nursery_portal_notifications_mark_read(
  p_token text
)
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  tok public.guardian_access_tokens;
  v_count int;
begin
  tok := public.portal_token_resolve(p_token);
  update public.guardian_notifications
  set read_at = now()
  where guardian_id = tok.guardian_id and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
