-- واتساب اختياري ذاتي — بوابات التفعيل (مهمة 2.2، نمط مستر 3A-300
-- المُثبت): لا إرسال فعلي في هذه المهمة إطلاقاً — البوابات والسجل
-- فقط. ترتيب البوابات ثابت: مفتاح قتل المنصة ← إعداد الحضانة ←
-- التفعيل ← القالب جاهز. أي إرسال مستقبلي يمر whatsapp_enqueue
-- فيُسجَّل قبل أن يحدث (أو يُحظر بسبب مسمّى).
create table public.platform_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.platform_settings (key, value)
values ('whatsapp_messaging_enabled', 'false'::jsonb);
alter table public.platform_settings enable row level security;
-- لا سياسات: لا وصول للعميل إطلاقاً — القراءة عبر دوال آمنة فقط

create table public.nursery_whatsapp_config (
  nursery_id      uuid primary key references public.nurseries (id) on delete cascade,
  phone_number_id text,
  display_phone   text,
  template_status text not null default 'none'
                    check (template_status in ('none', 'submitted', 'approved')),
  enabled         boolean not null default false,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);
alter table public.nursery_whatsapp_config enable row level security;
create policy whatsapp_config_owner_all on public.nursery_whatsapp_config
  for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

create table public.whatsapp_send_log (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  guardian_id uuid references public.guardians (id) on delete set null,
  template    text not null,
  params      jsonb not null default '{}'::jsonb,
  status      text not null check (status in
                ('blocked_kill_switch', 'blocked_not_configured',
                 'blocked_not_enabled', 'blocked_template', 'queued')),
  created_at  timestamptz not null default now()
);
create index whatsapp_send_log_nursery_idx
  on public.whatsapp_send_log (nursery_id, created_at desc);
alter table public.whatsapp_send_log enable row level security;
create policy whatsapp_log_owner_read on public.whatsapp_send_log
  for select using (public.is_nursery_owner(nursery_id));

-- فحص البوابات بالترتيب — أول بوابة ساقطة هي الجواب
create or replace function public.whatsapp_gate_check(p_nursery uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kill jsonb;
  v_cfg public.nursery_whatsapp_config;
begin
  select value into v_kill from public.platform_settings
  where key = 'whatsapp_messaging_enabled';
  if coalesce(v_kill, 'false'::jsonb) <> 'true'::jsonb then
    return 'kill_switch';
  end if;
  select * into v_cfg from public.nursery_whatsapp_config
  where nursery_id = p_nursery;
  if not found or v_cfg.phone_number_id is null then
    return 'not_configured';
  end if;
  if not v_cfg.enabled then
    return 'not_enabled';
  end if;
  if v_cfg.template_status <> 'approved' then
    return 'template_not_ready';
  end if;
  return 'ready';
end $$;

-- «إرسال» محكوم بالبوابات: يُسجَّل دائماً، ولا يرسل شيئاً أبداً في
-- هذه المرحلة — 'queued' تعني «كان سيُرسل لو وُجد المُرسِل»
create or replace function public.whatsapp_enqueue(
  p_nursery uuid, p_guardian uuid, p_template text, p_params jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate text;
  v_status text;
begin
  if auth.uid() is null or not public.is_nursery_owner(p_nursery) then
    raise exception 'not_owner';
  end if;
  v_gate := public.whatsapp_gate_check(p_nursery);
  v_status := case v_gate
    when 'kill_switch' then 'blocked_kill_switch'
    when 'not_configured' then 'blocked_not_configured'
    when 'not_enabled' then 'blocked_not_enabled'
    when 'template_not_ready' then 'blocked_template'
    else 'queued'
  end;
  insert into public.whatsapp_send_log
    (nursery_id, guardian_id, template, params, status)
  values (p_nursery, p_guardian, p_template, coalesce(p_params, '{}'::jsonb),
          v_status);
  return v_status;
end $$;
revoke execute on function public.whatsapp_enqueue(uuid, uuid, text, jsonb)
  from public, anon;
grant execute on function public.whatsapp_enqueue(uuid, uuid, text, jsonb)
  to authenticated;
