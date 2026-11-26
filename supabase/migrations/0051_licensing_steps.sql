-- 4.12: مسار الترخيص خطوة بخطوة — حالة كل خطوة لكل حضانة (مالك
-- فقط: ملف إداري). الخطوات نفسها معرّفة في العميل (قائمة إرشادية
-- ثابتة)؛ الجدول يخزن الحالة فقط.

create table public.licensing_steps (
  nursery_id uuid not null references public.nurseries(id) on delete cascade,
  step_key text not null,
  status text not null default 'todo'
    check (status in ('todo','done','na')),
  updated_at timestamptz not null default now(),
  primary key (nursery_id, step_key)
);

alter table public.licensing_steps enable row level security;

create policy licensing_steps_owner_all on public.licensing_steps
  for all to authenticated
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

grant select, insert, update, delete on public.licensing_steps to authenticated;
