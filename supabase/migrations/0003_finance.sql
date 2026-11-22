-- ============================================================================
-- نونو — 0003_finance.sql
-- المالية: فواتير شهرية ببنود + مدفوعات بإثبات ومراجعة + أرصدة عبر views.
--
-- قواعد صلبة (من المدرس + الدلتا §٢.٥):
-- • المالية للمالك فقط على مستوى RLS — لا سياسة عضو إطلاقاً هنا.
-- • الأرصدة محسوبة عبر views لا مخزّنة؛ الدفعة بإثبات لا تُحتسب حتى اعتمادها.
-- • لا حذف لمدفوعات: الإلغاء بعكس (reversal) بسطر مقابل.
-- • أرقام الإيصالات ذرّية عبر receipt_counters + قفل صف.
-- ============================================================================

begin;

create type invoice_status as enum ('draft', 'issued', 'cancelled');
create type invoice_line_type as enum ('base', 'discount', 'adjustment', 'bus', 'extra');
create type proof_status as enum ('not_required', 'pending', 'approved', 'rejected');

-- عدّادات إيصالات ذرّية لكل حضانة
create table public.receipt_counters (
  nursery_id uuid primary key references public.nurseries (id) on delete cascade,
  last_no    int not null default 0
);

create or replace function public.next_receipt_no(p_nursery uuid)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_no int;
begin
  if not public.is_nursery_owner(p_nursery) then
    raise exception 'not_authorized';
  end if;
  insert into public.receipt_counters (nursery_id, last_no) values (p_nursery, 1)
  on conflict (nursery_id) do update set last_no = receipt_counters.last_no + 1
  returning last_no into v_no;
  return v_no;
end $$;

-- ----------------------------------------------------------------------------
-- الفواتير وبنودها
-- ----------------------------------------------------------------------------
create table public.invoices (
  id          uuid primary key default gen_random_uuid(),
  nursery_id  uuid not null references public.nurseries (id) on delete cascade,
  child_id    uuid not null references public.children (id) on delete cascade,
  period      text not null,  -- 'YYYY-MM'
  status      invoice_status not null default 'draft',
  due_date    date,
  notes       text,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (nursery_id, child_id, period)
);
create index invoices_nursery_period_idx on public.invoices (nursery_id, period, status);
create index invoices_child_idx on public.invoices (child_id, period desc);
create trigger invoices_updated_trg before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_lines (
  id         uuid primary key default gen_random_uuid(),
  nursery_id uuid not null references public.nurseries (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  type       invoice_line_type not null,
  label      text not null,
  amount     numeric(12,2) not null,  -- الخصم/التسوية قد تكون سالبة
  created_at timestamptz not null default now()
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

-- ----------------------------------------------------------------------------
-- المدفوعات (مع الإثبات ومراجعته على نفس الصف — الدلتا §٢.٥)
-- ----------------------------------------------------------------------------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  nursery_id       uuid not null references public.nurseries (id) on delete cascade,
  invoice_id       uuid references public.invoices (id) on delete set null,
  child_id         uuid not null references public.children (id) on delete cascade,
  amount           numeric(12,2) not null check (amount > 0),
  method           payment_method not null,
  receipt_no       int,
  paid_at          timestamptz not null default now(),
  -- الإثبات: نقدي = not_required دائماً؛ إلكتروني بلا صورة يبقى pending صامتاً
  proof_path       text,
  proof_status     proof_status not null default 'not_required',
  proof_confirmed_at timestamptz,
  reviewed_by      uuid references auth.users (id),
  reviewed_at      timestamptz,
  rejection_reason text,
  -- الإلغاء بالعكس فقط
  reverses_id      uuid references public.payments (id),
  reversed_by_id   uuid references public.payments (id),
  recorded_by      uuid references auth.users (id),
  -- مصدر الدفعة: الإدارة أم بوابة ولي الأمر (عبر RPC التوكن)
  source           text not null default 'admin' check (source in ('admin','portal')),
  guardian_id      uuid references public.guardians (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (nursery_id, receipt_no)
);
create index payments_child_idx on public.payments (child_id, paid_at desc);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_proof_queue_idx on public.payments (nursery_id, proof_status, created_at)
  where proof_status = 'pending';
create trigger payments_updated_trg before update on public.payments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- الأرصدة (views — الدفعة المؤثرة: معتمدة أو بلا إثبات مطلوب، وليست معكوسة)
-- ----------------------------------------------------------------------------
create or replace view public.invoice_balances as
select
  i.id as invoice_id,
  i.nursery_id,
  i.child_id,
  i.period,
  i.status,
  coalesce(sum(l.amount), 0)::numeric(12,2) as total,
  coalesce((
    select sum(p.amount) from public.payments p
    where p.invoice_id = i.id
      and p.proof_status in ('not_required', 'approved')
      and p.reversed_by_id is null
  ), 0)::numeric(12,2) as paid,
  (coalesce(sum(l.amount), 0) - coalesce((
    select sum(p.amount) from public.payments p
    where p.invoice_id = i.id
      and p.proof_status in ('not_required', 'approved')
      and p.reversed_by_id is null
  ), 0))::numeric(12,2) as balance
from public.invoices i
left join public.invoice_lines l on l.invoice_id = i.id
group by i.id, i.nursery_id, i.child_id, i.period, i.status;

create or replace view public.child_balances as
select
  b.nursery_id,
  b.child_id,
  coalesce(sum(b.total), 0)::numeric(12,2) as total_due,
  coalesce(sum(b.paid), 0)::numeric(12,2) as total_paid,
  coalesce(sum(b.balance), 0)::numeric(12,2) as balance
from public.invoice_balances b
where b.status = 'issued'
group by b.nursery_id, b.child_id;

-- ----------------------------------------------------------------------------
-- RLS — المالك فقط، بلا أي سياسة عضو (خط المال الأحمر)
-- ----------------------------------------------------------------------------
alter table public.receipt_counters enable row level security;
create policy receipt_counters_owner on public.receipt_counters for select
  using (public.is_nursery_owner(nursery_id));

alter table public.invoices enable row level security;
create policy invoices_owner_all on public.invoices for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

alter table public.invoice_lines enable row level security;
create policy invoice_lines_owner_all on public.invoice_lines for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

alter table public.payments enable row level security;
create policy payments_owner_all on public.payments for all
  using (public.is_nursery_owner(nursery_id))
  with check (public.is_nursery_owner(nursery_id));

-- الـ views ترث أمان جداولها الأساسية عبر سياسات المالك أعلاه (لا سياسات على views)

-- ----------------------------------------------------------------------------
-- تخزين إثباتات الدفع (bucket ‏payment-proofs من 0001)
-- المسار دائماً «<nursery_id>/<payment_id>.<ext>» ويولّده الخادم داخل RPC البوابة.
-- • المالك يقرأ/يحذف ملفات حضانته فقط.
-- • anon إدراج فقط لمسار دفعة pending مؤكدة التوكن (دالة الحارس أدناه) —
--   لا قراءة ولا سرد ولا حذف لـ anon إطلاقاً (نمط المدرس 0005 حرفياً).
-- ----------------------------------------------------------------------------
create or replace function public.payment_proof_upload_allowed(p_path text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.payments p
    where p.proof_path = p_path
      and p.proof_status = 'pending'
      and p.source = 'portal'
  );
$$;

create policy proofs_owner_read on storage.objects for select
  using (bucket_id = 'payment-proofs'
         and public.is_nursery_owner(((storage.foldername(name))[1])::uuid));
create policy proofs_owner_delete on storage.objects for delete
  using (bucket_id = 'payment-proofs'
         and public.is_nursery_owner(((storage.foldername(name))[1])::uuid));
create policy proofs_anon_insert on storage.objects for insert
  with check (bucket_id = 'payment-proofs'
              and public.payment_proof_upload_allowed(name));

commit;
