-- 4.18: لوحة مشغّل المنصة — مراقبة المستأجرين لعيون 3A فقط.
-- لا سياسات قراءة عامة: البيانات تخرج فقط عبر RPC بحارس صريح.

create table public.platform_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_operators enable row level security;

create policy platform_operators_self_read on public.platform_operators
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.platform_operators to authenticated;

create or replace function public.is_platform_operator()
returns boolean
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.platform_operators
     where user_id = auth.uid()
  );
$function$;

create or replace function public.platform_overview()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_platform_operator() then
    raise exception 'not_operator';
  end if;
  select coalesce(jsonb_agg(row order by (row->>'name')), '[]'::jsonb)
    into v_result
  from (
    select jsonb_build_object(
      'nursery_id', n.id,
      'name', n.name,
      'created_at', n.created_at,
      'children', (select count(*) from public.children c
                    where c.nursery_id = n.id),
      'members', (select count(*) from public.nursery_members m
                   where m.nursery_id = n.id and m.status = 'active'),
      'invoices_month', (select count(*) from public.invoices i
                          where i.nursery_id = n.id
                            and i.period = to_char(now(), 'YYYY-MM')),
      'last_activity', (select max(a.created_at)
                          from public.activity_log a
                         where a.nursery_id = n.id)
    ) as row
    from public.nurseries n
  ) s;
  return v_result;
end $function$;

revoke execute on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;
revoke execute on function public.is_platform_operator()
  from public, anon;
grant execute on function public.is_platform_operator() to authenticated;
