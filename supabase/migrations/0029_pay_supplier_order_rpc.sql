-- دفعة سلامة المال 2 (مهمة 1.7 — ملاحظتا مراجعة 1.4): دفع أمر شراء
-- ذرّياً عبر RPC واحدة بدل ثلاث كتابات متتابعة من العميل (قيد خزنة
-- + دفعة + ربط ref): إما الكل أو لا شيء. وسقف صارم: الدفعة لا
-- تتجاوز متبقي الأمر أبداً (overpayment). حارس مالك صريح يعمل حتى
-- بلا auth.uid(). تجميد اليوم المقفل يسري عبر مشغّل الخزنة كالعادة.
create or replace function public.pay_supplier_order(
  p_nursery uuid,
  p_supplier uuid,
  p_order uuid,
  p_amount numeric,
  p_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.purchase_orders;
  v_supplier_name text;
  v_paid numeric;
  v_entry uuid;
  v_payment uuid;
begin
  if auth.uid() is null or not public.is_nursery_owner(p_nursery) then
    raise exception 'not_owner';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'bad_amount';
  end if;
  select * into v_order from public.purchase_orders
  where id = p_order and nursery_id = p_nursery and supplier_id = p_supplier;
  if not found then
    raise exception 'order_not_found';
  end if;
  select name into v_supplier_name from public.suppliers where id = p_supplier;
  select coalesce(sum(amount), 0) into v_paid
  from public.supplier_payments where order_id = p_order;
  if p_amount > v_order.total_amount - v_paid then
    raise exception 'overpayment';
  end if;

  insert into public.cashbox_entries (
    nursery_id, entry_date, direction, kind, title, amount,
    ref_type, created_by
  ) values (
    p_nursery, p_date, 'out', 'purchase',
    v_supplier_name || ' — ' || v_order.title, p_amount,
    'supplier_payment', auth.uid()
  ) returning id into v_entry;

  insert into public.supplier_payments (
    nursery_id, order_id, amount, paid_date, cashbox_entry_id, created_by
  ) values (
    p_nursery, p_order, p_amount, p_date, v_entry, auth.uid()
  ) returning id into v_payment;

  update public.cashbox_entries set ref_id = v_payment where id = v_entry;
  return v_payment;
end $$;

revoke execute on function public.pay_supplier_order(uuid, uuid, uuid, numeric, date)
  from public, anon;
grant execute on function public.pay_supplier_order(uuid, uuid, uuid, numeric, date)
  to authenticated;
