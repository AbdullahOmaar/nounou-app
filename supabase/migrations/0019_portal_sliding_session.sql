-- 3A-375 (الخيار أ — التوكن نفسه هو الجلسة، قرار المدير 2026-11-23):
-- انتهاء منزلق لجلسة جهاز ولي الأمر: كل resolve ناجح يمدّد
-- expires_at إلى الآن + 180 يوماً — من يفتح البوابة مرة كل ٦ شهور
-- على الأقل لا يرى انتهاء أبداً (يغطي إجازة الصيف).
-- القتل الحقيقي محفوظ: الفحصان يسبقان التمديد — توكن ملغى
-- (revoked_at) أو منتهٍ أصلاً يُرفض قبل أي تحديث، فإلغاء الحضانة
-- أو استبدال W1 يقتل الجلسة عند أول استدعاء تالٍ.
-- بلا منح للعامة كالأصل: تُستدعى داخلياً فقط من RPCs البوابة.
create or replace function public.portal_token_resolve(p_token text)
returns public.guardian_access_tokens
language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
begin
  select * into tok
  from public.guardian_access_tokens
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and revoked_at is null
    and expires_at > now();
  if not found then
    raise exception 'invalid or expired token';
  end if;
  update public.guardian_access_tokens
     set last_used_at = now(),
         expires_at = now() + interval '180 days'
   where id = tok.id;
  return tok;
end $$;
revoke execute on function public.portal_token_resolve(text) from public, anon, authenticated;
