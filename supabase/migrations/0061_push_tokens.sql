-- 0061: ربط توكن الدفع خادمياً (3A-412 — الخطوة الخادمية)
-- توكن FCM لكل جهاز طاقم (حضانة + مستخدم + منصة) يُسجَّل عبر RPC محروسة
-- فقط؛ الكتابة المباشرة على الجدول مرفوضة (لا سياسات إدراج/تعديل).
-- الإرسال عبر صندوق صادر (outbox): مشغّلات أحداث الطاقم (إثبات دفع
-- مُقدَّم، طلب جولة جديد) تُدرج صفاً لكل عضو فعّال، ودالة Edge
-- (send-push) تُفرغه كل دقيقة عبر pg_cron — والبوابة هي إعداد
-- push_enabled لكل حضانة (افتراضياً مقفول — opt-in للمالك).
-- الإرسال الفعلي إلى FCM يحتاج سرّ حساب خدمة Firebase (FCM_SERVICE_ACCOUNT)
-- في أسرار Edge Functions — بدونه تبقى الصفوف queued ولا يُرسَل شيء
-- (الدالة تعود 503 push_not_configured). لا أسرار في الكود أو الهجرة.

-- ---------------------------------------------------------------------------
-- توكنات أجهزة الطاقم: توكن واحد لكل (حضانة، مستخدم، منصة) — إعادة
-- التسجيل تستبدل التوكن القديم. التوكن مادة اعتماد جهاز: القراءة
-- للأعضاء فقط، والكتابة عبر RPC فقط.
-- ملحوظة أمان: التوكن يُخزَّن نصاً لا hash — FCM يتطلب التوكن نفسه
-- حرفياً للإرسال، فالـhash يجعله عديم الفائدة؛ والحماية هنا هي
-- RLS (أعضاء الحضانة فقط) + الكتابة عبر RPC فقط + أن التوكن وحده
-- لا يرسل شيئاً بلا مفتاح خادم FCM (سرّ منفصل في Vault).
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  platform    text not null check (platform in ('android', 'ios')),
  token       text not null check (char_length(token) between 10 and 4096),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_used_at timestamptz,
  unique (nursery_id, user_id, platform)
);
create index push_tokens_user_idx
  on public.push_tokens (nursery_id, user_id);

alter table public.push_tokens enable row level security;
create policy push_tokens_member_read
  on public.push_tokens for select
  using (public.is_nursery_member(nursery_id));
grant select on public.push_tokens to authenticated;

create trigger push_tokens_updated_trg before update on public.push_tokens
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- تسجيل التوكن: SECURITY DEFINER بحارس صريح + تحقق عضوية + تحقق مدخلات.
-- تُستدعى من التطبيق الأصلي بعد تسجيل الجهاز لدى FCM/APNs.
-- ---------------------------------------------------------------------------
create or replace function public.register_push_token(
  p_nursery uuid, p_platform text, p_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- حارس المصادقة الصريح (قاعدة البيت): يفشل أيضاً عند غياب auth.uid()
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception 'invalid platform';
  end if;
  if p_token is null or char_length(p_token) < 10
     or char_length(p_token) > 4096 then
    raise exception 'invalid token';
  end if;
  if not public.is_nursery_member(p_nursery) then
    raise exception 'not a nursery member';
  end if;
  insert into public.push_tokens (nursery_id, user_id, platform, token, last_used_at)
  values (p_nursery, auth.uid(), p_platform, p_token, now())
  on conflict (nursery_id, user_id, platform)
  do update set token = excluded.token,
                updated_at = now(),
                last_used_at = now();
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- صندوق الصادر: صف لكل عضو مستهدف؛ دالة send-push تُفرغه وترسل عبر FCM.
-- القراءة للأعضاء فقط؛ الكتابة للمشغّلات الداخلية فقط (بلا سياسات).
-- ---------------------------------------------------------------------------
create table public.push_outbox (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('proof_submitted', 'tour_requested')),
  data        jsonb not null default '{}'::jsonb,
  status      text not null default 'queued'
    check (status in ('queued', 'sent', 'failed')),
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index push_outbox_queue_idx
  on public.push_outbox (status, created_at);

alter table public.push_outbox enable row level security;
create policy push_outbox_member_read
  on public.push_outbox for select
  using (public.is_nursery_member(nursery_id));
grant select on public.push_outbox to authenticated;

-- ---------------------------------------------------------------------------
-- الإدراج الداخلي: يوزّع على كل الأعضاء الفعّالين في الحضانة، ويتخطى
-- الحضانة كلها إن كان opt-in مقفولاً. داخلية فقط (مُبطَلة للعموم).
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_staff_push(
  p_nursery uuid, p_kind text, p_data jsonb
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_count int;
begin
  select push_enabled into v_enabled
  from public.nursery_settings
  where nursery_id = p_nursery;
  if v_enabled is not true then
    return 0;
  end if;
  insert into public.push_outbox (nursery_id, user_id, kind, data)
  select p_nursery, m.user_id, p_kind, coalesce(p_data, '{}'::jsonb)
  from public.nursery_members m
  where m.nursery_id = p_nursery and m.status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function
  public.enqueue_staff_push(uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- opt-in لكل حضانة (المالك يفعّله من الإعدادات) — افتراضياً مقفول.
-- ---------------------------------------------------------------------------
alter table public.nursery_settings
  add column push_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- مشغّل ١: ولي أمر يقدّم إثبات دفع (إدراج أو تحوّل إلى pending) —
-- الطاقم يُنبَّه (نفس حدث «proofsPending» المحسوب في التطبيق).
-- ---------------------------------------------------------------------------
create or replace function public.notify_staff_on_proof()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.proof_status = 'pending'
     and (tg_op = 'INSERT' or old.proof_status is distinct from 'pending') then
    perform public.enqueue_staff_push(
      new.nursery_id, 'proof_submitted',
      jsonb_build_object('child_id', new.child_id, 'amount', new.amount));
  end if;
  return new;
end $$;
create trigger payments_proof_staff_push_trg
  after insert or update of proof_status on public.payments
  for each row execute function public.notify_staff_on_proof();

-- ---------------------------------------------------------------------------
-- مشغّل ٢: طلب جولة جديد من الصفحة العامة — الطاقم يُنبَّه.
-- ---------------------------------------------------------------------------
create or replace function public.notify_staff_on_tour()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_staff_push(
    new.nursery_id, 'tour_requested',
    jsonb_build_object(
      'parent_name', new.parent_name, 'child_name', new.child_name));
  return new;
end $$;
create trigger tour_requests_staff_push_trg
  after insert on public.tour_requests
  for each row execute function public.notify_staff_on_tour();

-- ---------------------------------------------------------------------------
-- المُستدعي المجدول: يقرأ السرّين من Vault ويستدعي send-push بمفتاح
-- الخدمة — نفس نمط 0012 (photo-retention). قبل وجود السرّين تعود
-- بصمت (NOTICE فقط). الدالة للجدولة الداخلية فقط.
-- ---------------------------------------------------------------------------
create or replace function public.invoke_send_push_scheduled()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  if auth.uid() is not null then
    raise exception 'scheduled invocation only';
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise notice 'send-push schedule: vault secrets missing — skipped';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  );
end $$;

revoke execute on function public.invoke_send_push_scheduled()
  from public, anon, authenticated;

-- الجدولة: كل دقيقة. إعادة التطبيق آمنة: فكّ أي وظيفة بنفس الاسم أولاً.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-outbox-minute') then
    perform cron.unschedule('push-outbox-minute');
  end if;
end $$;

select cron.schedule(
  'push-outbox-minute',
  '* * * * *',
  $$select public.invoke_send_push_scheduled();$$
);
