-- تصحيح 2.8: جداول 0034 الجديدة تحتاج منحاً صريحة لـ Data API
-- (قاعدة ما بعد 30 أكتوبر 2026: لا منح تلقائي للجداول الجديدة)
grant select, insert, update, delete on public.qa_sessions to authenticated;
grant select, insert, update, delete on public.qa_questions to authenticated;
notify pgrst, 'reload schema';
