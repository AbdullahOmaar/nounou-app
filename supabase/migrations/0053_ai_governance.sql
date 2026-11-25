-- 4.15: حوكمة الذكاء الاصطناعي — سجل استخدام + سقوف إنفاق لكل
-- حضانة. لا نداء ذكاء فعلياً في نونو بعد (مفاتيح المزود قرار
-- مالك)؛ هذه هي البوابة التي يمر بها أي سطح ذكاء مستقبلي:
-- لا إنفاق بلا سقف، وكل نداء يتسجل (docs/AI-GOVERNANCE.md).

create table public.ai_spend_caps (
  nursery_id uuid primary key
    references public.nurseries(id) on delete cascade,
  monthly_cap_micro bigint not null default 0
    check (monthly_cap_micro >= 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid references public.nurseries(id) on delete cascade,
  surface text not null,
  model text not null,
  units integer not null default 0,
  cost_micro bigint not null default 0,
  created_at timestamptz not null default now()
);

create index ai_usage_month_idx
  on public.ai_usage_log (nursery_id, created_at);

alter table public.ai_spend_caps enable row level security;
alter table public.ai_usage_log enable row level security;

create policy ai_caps_owner_all on public.ai_spend_caps
  for all to authenticated
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

create policy ai_usage_owner_read on public.ai_usage_log
  for select to authenticated
  using (nursery_id is not null and public.is_nursery_owner(nursery_id));

grant select, insert, update on public.ai_spend_caps to authenticated;
grant select on public.ai_usage_log to authenticated;
