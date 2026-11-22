-- 0012_api_grants.sql — صلاحيات أدوار API على مخطط public (إصلاح تفعيل 3A-323)
--
-- المشكلة (حية 2026-11-23): على مشروع Supabase جديد (PG17) لم تُفعَّل
-- الامتيازات الافتراضية التي تمنح عادةً أدوار anon/authenticated/
-- service_role صلاحيات DML على جداول public عند إنشائها عبر مسار
-- SQL API — فبقيت الأدوار بلا SELECT/INSERT/UPDATE/DELETE وكل طلبات
-- PostgREST ترجع 42501 (حتى للمالك)، رغم أن سياسات RLS سليمة.
-- الحل: منح صريح بوضع Supabase القياسي — الحارس الحقيقي هو RLS
-- (مفعّل على كل الجداول، وبلا أي سياسة لـ anon فيقرأ صفر صفوف).
-- + امتيازات افتراضية حتى تأخذ أي جداول مستقبلية نفس المنح تلقائياً.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select
  on all sequences in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences
  to anon, authenticated, service_role;
