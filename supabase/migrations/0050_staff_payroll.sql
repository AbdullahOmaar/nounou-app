-- 4.6: إدارة الفريق — ملفات رواتب (مالك فقط) + حضور فريق + سجل
-- صرف رواتب يتدفق لمصروفات 1.2 (فئة salaries الموجودة أصلاً).
-- قاعدة الصرف: المرتب الشهري ناقص خصم أيام الغياب (مرتب/30 × أيام
-- الغياب في الشهر) — قاعدة بسيطة معلنة، والمالك يراجع قبل الصرف.

create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  member_id uuid not null references public.nursery_members(id) on delete cascade,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  job_title text,
  created_at timestamptz not null default now(),
  unique (nursery_id, member_id)
);

alter table public.staff_profiles enable row level security;

create policy staff_profiles_owner_all on public.staff_profiles
  for all to authenticated
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

grant select, insert, update, delete on public.staff_profiles to authenticated;

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  member_id uuid not null references public.nursery_members(id) on delete cascade,
  day date not null,
  status text not null check (status in ('present','absent','late','leave')),
  created_at timestamptz not null default now(),
  unique (nursery_id, member_id, day)
);

alter table public.staff_attendance enable row level security;

create policy staff_attendance_member_all on public.staff_attendance
  for all to authenticated
  using (public.is_nursery_member(nursery_id))
  with check (public.is_nursery_member(nursery_id));

grant select, insert, update, delete on public.staff_attendance to authenticated;

create table public.staff_payroll (
  id uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  member_id uuid not null references public.nursery_members(id) on delete cascade,
  period text not null,
  amount numeric(12,2) not null check (amount >= 0),
  absent_days integer not null default 0,
  expense_id uuid references public.nursery_expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (nursery_id, member_id, period)
);

alter table public.staff_payroll enable row level security;

create policy staff_payroll_owner_all on public.staff_payroll
  for all to authenticated
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

grant select, insert, update, delete on public.staff_payroll to authenticated;

create or replace function public.pay_staff_salary(
  p_nursery uuid,
  p_member uuid,
  p_period text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salary numeric(12,2);
  v_absent integer;
  v_amount numeric(12,2);
  v_label text;
  v_expense uuid;
begin
  if not public.is_nursery_owner(p_nursery) then
    raise exception 'not_owner';
  end if;
  select monthly_salary into v_salary
  from public.staff_profiles
  where nursery_id = p_nursery and member_id = p_member;
  if v_salary is null or v_salary <= 0 then
    raise exception 'no_salary';
  end if;
  if exists (
    select 1 from public.staff_payroll
    where nursery_id = p_nursery and member_id = p_member and period = p_period
  ) then
    raise exception 'already_paid';
  end if;
  select count(*) into v_absent
  from public.staff_attendance
  where nursery_id = p_nursery and member_id = p_member
    and status = 'absent'
    and to_char(day, 'YYYY-MM') = p_period;
  v_amount := round(v_salary - (v_salary / 30.0) * v_absent, 2);
  if v_amount < 0 then
    v_amount := 0;
  end if;
  select coalesce(m.invited_email, u.email, 'staff') into v_label
  from public.nursery_members m
  left join auth.users u on u.id = m.user_id
  where m.id = p_member and m.nursery_id = p_nursery;
  insert into public.nursery_expenses
    (nursery_id, period, expense_date, category, title, amount, created_by)
  values
    (p_nursery, p_period, current_date, 'salaries',
     'salary ' || p_period || ' — ' || coalesce(v_label, 'staff'),
     v_amount, auth.uid())
  returning id into v_expense;
  insert into public.staff_payroll
    (nursery_id, member_id, period, amount, absent_days, expense_id)
  values
    (p_nursery, p_member, p_period, v_amount, v_absent, v_expense);
  return v_amount;
end;
$$;

revoke execute on function public.pay_staff_salary(uuid, uuid, text) from public, anon;
grant execute on function public.pay_staff_salary(uuid, uuid, text) to authenticated;
