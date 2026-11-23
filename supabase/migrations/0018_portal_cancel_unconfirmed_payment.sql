-- 3A-395 (بند 2): إلغاء تعويضي لدفعة بوابة غير مؤكدة.
-- فشل رفع الإثبات (أو تأكيده) كان يترك دفعة pending بمسار إثبات
-- يشير لملف غير موجود — غير مرئية لمراجعة المالك (تُصفّى
-- بـ proof_confirmed_at) لكنها يتيمة وتتضاعف عند إعادة المحاولة.
-- العميل الآن يلغي الدفعة عبر هذا الـ RPC عند أي فشل بعد الإنشاء.
create or replace function public.nursery_portal_cancel_payment(
  p_token text, p_payment_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
begin
  tok := public.portal_token_resolve(p_token);
  delete from public.payments
  where id = p_payment_id
    and nursery_id = tok.nursery_id
    and guardian_id = tok.guardian_id
    and proof_status = 'pending'
    and proof_confirmed_at is null;
  if not found then
    raise exception 'not authorized';
  end if;
end $$;
revoke execute on function public.nursery_portal_cancel_payment(text, uuid)
  from public, anon, authenticated;
grant execute on function public.nursery_portal_cancel_payment(text, uuid)
  to anon, authenticated;
