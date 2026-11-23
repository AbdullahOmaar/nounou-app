-- 0016_upsert_update_policies.sql
-- سياسات UPDATE مفقودة لجدولين يُكتبان بـ upsert من العميل.
-- اكتُشف في بوابة E2E الحية (3A-323): upsert في PostgREST هو
-- INSERT ... ON CONFLICT DO UPDATE، وعند وجود الصف أصلاً يحتاج سياسة UPDATE؛
-- بدونها يرجع 403 — قائمة باص اليوم كانت تعمل في أول فتح فقط ثم تنكسر
-- لبقية اليوم (bus_day_lists)، ونفس العيب كامن في ربط الأوصياء (guardian_children).
-- الصيغ مرآة حرفية لسياسات INSERT القائمة على الجدولين.

create policy bus_lists_bus_update on public.bus_day_lists for update
  using (public.member_has_permission(nursery_id, 'can_manage_bus'))
  with check (public.member_has_permission(nursery_id, 'can_manage_bus'));

create policy guardian_children_manage_update on public.guardian_children for update
  using (exists (select 1 from public.guardians g
                  where g.id = guardian_id
                    and public.member_has_permission(g.nursery_id, 'can_manage_children')))
  with check (exists (select 1 from public.guardians g
                      where g.id = guardian_id
                        and public.member_has_permission(g.nursery_id, 'can_manage_children')));
