-- ============================================================================
-- 0012 — جدولة حذف الاحتفاظ أسبوعياً (3A-350: دفعة تقوية ما بعد التفعيل)
-- ----------------------------------------------------------------------------
-- دالة photo-retention (3A-335) كانت تُستدعى يدوياً فقط. هذه الهجرة
-- تجدولها أسبوعياً عبر pg_cron + pg_net بالنمط الرسمي من Supabase:
-- عنوان المشروع ومفتاح الخدمة يُقرآن وقت التشغيل من Vault — لا أسرار
-- في الكود أو التاريخ أبداً (قاعدة AGENTS.md).
--
-- ⚠️ سرّا Vault ‎('project_url'‎ و‎'service_role_key')‎ يُنشآن في خطوة
--   ما بعد التفعيل (docs/ACTIVATION.md خطوة 11) — قبل وجودهما تعود
--   الدالة المجدولة بصمت (تنبيه NOTICE فقط)، لا فشل صاخب في
--   cron.job_run_details، والهجرة نفسها تُطبَّق بأمان في أي وقت.
-- ⚠️ الطبقة المجانية: مشروع بلا نشاط ~7 أيام ينام فيموت pg_cron معه —
--   بعد أي إجازة طويلة: أيقظ المشروع وشغّل الحذف يدوياً مرة
--   (docs/INCIDENT-RUNBOOK.md).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- المُستدعي المجدول: يقرأ السرّين من Vault ويستدعي دالة الحذف بمفتاح
-- الخدمة. SECURITY DEFINER بحارس صريح: لا تنفيذ لأي دور تطبيقي —
-- pg_cron يعمل بصلاحية مالك الوظيفة (postgres) فقط.
-- ----------------------------------------------------------------------------
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
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  );
end $$;

revoke execute on function public.invoke_photo_retention_scheduled()
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- الجدولة: كل أحد 03:00 UTC. إعادة التطبيق آمنة: فكّ أي وظيفة بنفس
-- الاسم أولاً ثم الجدولة من جديد (لا وظائف مكررة).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'photo-retention-weekly') then
    perform cron.unschedule('photo-retention-weekly');
  end if;
end $$;

select cron.schedule(
  'photo-retention-weekly',
  '0 3 * * 0',
  $$select public.invoke_photo_retention_scheduled();$$
);
