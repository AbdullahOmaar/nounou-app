-- ============================================================================
-- نونو — 0013_money_integrity.sql
-- سلامة المال (3A-363 — اعتماد المدير 2026-11-22، اقتراحات الجولة ٧):
--
-- V3 • رقم إيصال موحّد: مشغّل BEFORE INSERT على payments يملأ receipt_no
--      من عدّاد receipt_counters الذرّي (نفس آلية next_receipt_no لكن بلا
--      حارس مالك — المشغّل يجب أن يعمل لسياقات بلا auth.uid() مثل RPC
--      البوابة بـ service_role) عند غياب الرقم فقط. مصدر حقيقة وحيد لكل
--      مسارات الإدراج: إدارة + بوابة + عكس. الإسناد اليدوي في العميل
--      أُزيل في نفس الدفعة.
-- V1 • حارس إلغاء الفاتورة: مشغّل BEFORE UPDATE يرفض تحويل فاتورة إلى
--      cancelled عند وجود أي دفعة مرتبطة بها غير معكوسة وليست سطر عكس
--      وحالتها فعّالة (not_required/approved) أو معلّقة المراجعة
--      (pending) — حتى لا يتيمّ النقد المسجّل ويختفي من كل الأرصدة.
--      الرفض برسالة ثابتة invoice_has_payments.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- V3: تعبئة رقم الإيصال عند الإدراج
-- ----------------------------------------------------------------------------
create or replace function public.assign_receipt_no()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.receipt_no is null then
    insert into public.receipt_counters (nursery_id, last_no)
    values (new.nursery_id, 1)
    on conflict (nursery_id)
      do update set last_no = receipt_counters.last_no + 1
    returning last_no into new.receipt_no;
  end if;
  return new;
end $$;

-- دالة مشغّل داخلية: لا تُستدعى عبر RPC إطلاقاً
revoke execute on function public.assign_receipt_no() from public, anon, authenticated;

create trigger payments_assign_receipt_trg
  before insert on public.payments
  for each row execute function public.assign_receipt_no();

-- ----------------------------------------------------------------------------
-- V1: حارس إلغاء فاتورة عليها دفعات حيّة
-- ----------------------------------------------------------------------------
create or replace function public.guard_invoice_cancel()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if exists (
      select 1 from public.payments p
      where p.invoice_id = old.id
        and p.reversed_by_id is null
        and p.reverses_id is null
        and p.proof_status in ('not_required', 'approved', 'pending')
    ) then
      raise exception 'invoice_has_payments';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.guard_invoice_cancel() from public, anon, authenticated;

create trigger invoices_cancel_guard_trg
  before update on public.invoices
  for each row execute function public.guard_invoice_cancel();

commit;
