-- 4.17: سقوف ميزانية رسائل واتساب لكل حضانة. السقف حد صلب:
-- يُفحص قبل سلسلة البوابات، وكل محاولة تتسجل كالمعتاد في
-- whatsapp_send_log بحالة blocked_budget (docs/WHATSAPP-COSTS.md).

create table public.whatsapp_budgets (
  nursery_id uuid primary key
    references public.nurseries(id) on delete cascade,
  monthly_cap integer not null default 0 check (monthly_cap >= 0),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_budgets enable row level security;

create policy whatsapp_budgets_owner_all on public.whatsapp_budgets
  for all to authenticated
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

grant select, insert, update on public.whatsapp_budgets to authenticated;

create or replace function public.whatsapp_enqueue(
  p_nursery uuid, p_guardian uuid, p_template text, p_params jsonb)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_gate text;
  v_status text;
  v_cap integer;
  v_used integer;
begin
  if auth.uid() is null or not public.is_nursery_owner(p_nursery) then
    raise exception 'not_owner';
  end if;
  select monthly_cap into v_cap
    from public.whatsapp_budgets where nursery_id = p_nursery;
  if v_cap is not null then
    select count(*) into v_used
      from public.whatsapp_send_log
     where nursery_id = p_nursery
       and created_at >= date_trunc('month', now());
    if v_used >= v_cap then
      insert into public.whatsapp_send_log
        (nursery_id, guardian_id, template, params, status)
      values (p_nursery, p_guardian, p_template,
              coalesce(p_params, '{}'::jsonb), 'blocked_budget');
      return 'blocked_budget';
    end if;
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
end $function$;
