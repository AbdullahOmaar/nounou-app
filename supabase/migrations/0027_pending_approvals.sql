-- «اعتماد ثانٍ» (مهمة 1.5): أفعال مالية فوق حدود لا تُنفَّذ فوراً —
-- تُحفظ طلباً معلّقاً بحمولته الكاملة، ولا تُنفَّذ إلا باعتماد مالك
-- (خطوة ثانية واعية، وتُسجَّل في سجل النشاط طلباً وقراراً).
-- الحدود (ورقة 1.1، تُراجع بعد أول شهر بايلوت): اعتماد إثبات
-- > 2000 ج.م، إقفال خزنة بفرق ≠ 0، إلغاء فاتورة فيها دفعة،
-- مصروف > 5000 ج.م. المالية للمالك فقط بـRLS كالعادة.
create table public.pending_approvals (
  id           uuid primary key default gen_random_uuid(),
  nursery_id   uuid not null references public.nurseries (id) on delete cascade,
  action_kind  text not null check (action_kind in
                 ('proof_approve', 'cashbox_close_diff', 'invoice_cancel_paid',
                  'expense_large')),
  payload      jsonb not null,
  summary      text not null,
  requested_by uuid references auth.users (id) on delete set null,
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected')),
  decided_by   uuid references auth.users (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index pending_approvals_nursery_status_idx
  on public.pending_approvals (nursery_id, status, created_at);

alter table public.pending_approvals enable row level security;
create policy pending_approvals_owner_all on public.pending_approvals for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));
