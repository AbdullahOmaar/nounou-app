-- ============================================================================
-- 0020 — استدعاء الاحتفاظ المجدول يرسل المفتاح على رأس apikey أيضاً
-- (ترحيل مفاتيح Supabase — 2026-11-23)
-- ----------------------------------------------------------------------------
-- المفاتيح السرية الجديدة (sb_secret_*) ليست JWT: دليل Supabase
-- الرسمي للترحيل يوجّه بإرسال المفتاح السري على رأس apikey في
-- استدعاءات pg_net بدل Authorization وحده. هذه الهجرة تعيد إنشاء
-- مُستدعي 0012 بنفس الحارس والجدولة، مع إضافة رأس apikey بنفس قيمة
-- Vault 'service_role_key' (التي صارت تحمل المفتاح السري الجديد) —
-- وAuthorization يبقى للتوافق أثناء الانتقال. لا أسرار في الكود.
-- ============================================================================

create or replace function public.invoke_photo_retention_scheduled()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text;
  v_key text;
begin
  -- حارس تفويض صريح (قاعدة البيت): الدالة للجدولة الداخلية فقط
  if auth.uid() is not null then
    raise exception 'scheduled invocation only';
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise notice 'photo-retention schedule: vault secrets missing — skipped';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/photo-retention',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := '{}'::jsonb
  );
end $$;

revoke execute on function public.invoke_photo_retention_scheduled()
  from public, anon, authenticated;
