-- 0015_portal_and_balances_fix.sql — إصلاحات أول تشغيل حي (3A-323)
--
-- عيبان كشفهما أول تشغيل لبوابة authz على الحي (104/109 قبل هذا الملف):
-- (1) دالتا البوابة (نظرة عامة + يوم الطفل) تستخدمان
--     jsonb_agg(x order by x.col) — وPostgres يفسر x.col كاسم جدول
--     (42P01: missing FROM-clause entry) فتنهار الدالتان مع أي بيانات.
--     الإصلاح: الترتيب بعمود الإدخال المجرد (نفس نمط order by child_name
--     العامل في نفس الملفات). أجساد الدوال منسوخة حرفياً من 0006/0010
--     مع سطور التجميع الأربعة فقط مصلحة.
-- (2) منظرا invoice_balances/child_balances كانا بلا security_invoker
--     فيعملان بصلاحية المالك (postgres) ويتجاوزان RLS: أي حامل مفتاح
--     anon أو أي مشرفة يقرأ أرصدة كل الحضانات. الإصلاح: إعادة إنشائهما
--     بـ security_invoker = true فتسري RLS على القارئ الفعلي
--     (anon: صفر، مشرفة: صفر — المال للمالك فقط، مالك: صفوفه).

create or replace view public.invoice_balances with (security_invoker = true) as
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
      and p.reverses_id is null
  ), 0)::numeric(12,2) as paid,
  (coalesce(sum(l.amount), 0) - coalesce((
    select sum(p.amount) from public.payments p
    where p.invoice_id = i.id
      and p.proof_status in ('not_required', 'approved')
      and p.reversed_by_id is null
      and p.reverses_id is null
  ), 0))::numeric(12,2) as balance
from public.invoices i
left join public.invoice_lines l on l.invoice_id = i.id
group by i.id, i.nursery_id, i.child_id, i.period, i.status;

create or replace view public.child_balances with (security_invoker = true) as
select
  b.nursery_id,
  b.child_id,
  coalesce(sum(b.total), 0)::numeric(12,2) as total_due,
  coalesce(sum(b.paid), 0)::numeric(12,2) as total_paid,
  coalesce(sum(b.balance), 0)::numeric(12,2) as balance
from public.invoice_balances b
where b.status = 'issued'
group by b.nursery_id, b.child_id;

create or replace function public.nursery_portal_overview_by_token(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
  v_children jsonb;
  v_announcements jsonb;
begin
  tok := public.portal_token_resolve(p_token);

  select coalesce(jsonb_agg(child_obj order by child_name), '[]'::jsonb)
  into v_children
  from (
    select
      c.full_name as child_name,
      jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'photo_consent', c.photo_consent,
        'class_name', cl.name,
        'balance', coalesce(cb.balance, 0),
        'total_paid', coalesce(cb.total_paid, 0)
      ) as child_obj
    from public.guardian_children gc
    join public.children c on c.id = gc.child_id and c.archived_at is null
    left join public.enrollments e on e.child_id = c.id and e.status = 'active'
    left join public.classes cl on cl.id = e.class_id
    left join public.child_balances cb on cb.child_id = c.id
    where gc.guardian_id = tok.guardian_id
      and (tok.child_id is null or tok.child_id = c.id)
  ) s;

  select coalesce(jsonb_agg(a order by published_at desc), '[]'::jsonb)
  into v_announcements
  from (
    select jsonb_build_object(
      'id', an.id, 'title', an.title, 'body', an.body, 'published_at', an.published_at
    ) as a, an.published_at
    from public.announcements an
    where an.nursery_id = tok.nursery_id and an.published_at is not null
    order by an.published_at desc
    limit 10
  ) s;

  return jsonb_build_object(
    'nursery', (select jsonb_build_object('name', n.name, 'phone', n.phone)
                from public.nurseries n where n.id = tok.nursery_id),
    'guardian', (select jsonb_build_object('full_name', g.full_name)
                 from public.guardians g where g.id = tok.guardian_id),
    'children', v_children,
    'announcements', v_announcements
  );
end $$;
grant execute on function public.nursery_portal_overview_by_token(text) to anon, authenticated;

create or replace function public.nursery_portal_child_day_by_token(
  p_token text, p_child_id uuid, p_date date default current_date)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
  v_attendance jsonb;
  v_report jsonb;
  v_photos jsonb;
  v_invoices jsonb;
  v_proofs jsonb;
  v_pickup_code text;
  v_code_enabled boolean;
begin
  tok := public.portal_token_resolve(p_token);
  if not public.portal_token_covers_child(tok, p_child_id) then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'status', a.status,
    'arrived_at', a.arrived_at,
    'picked_up_at', a.picked_up_at,
    'picked_up_by_name', coalesce(pp.full_name, g.full_name)
  ) into v_attendance
  from public.attendance a
  join public.class_days cd on cd.id = a.class_day_id and cd.day_date = p_date
  left join public.pickup_persons pp on pp.id = a.picked_up_by
  left join public.guardians g on g.id = a.picked_up_guardian_id
  where a.child_id = p_child_id;

  select jsonb_build_object(
    'meals', r.meals, 'nap_from', r.nap_from, 'nap_to', r.nap_to,
    'nap_slept', r.nap_slept, 'activities', r.activities,
    'mood', r.mood, 'note', r.note, 'published_at', r.published_at
  ) into v_report
  from public.daily_reports r
  join public.class_days cd on cd.id = r.class_day_id and cd.day_date = p_date
  where r.child_id = p_child_id and r.published_at is not null;

  select coalesce(jsonb_agg(p order by created_at), '[]'::jsonb)
  into v_photos
  from (
    select jsonb_build_object('id', ph.id, 'caption', ph.caption, 'created_at', ph.created_at) as p,
           ph.created_at
    from public.child_photos ph
    join public.photo_children pc on pc.photo_id = ph.id and pc.child_id = p_child_id
    join public.class_days cd on cd.id = ph.class_day_id and cd.day_date = p_date
    where exists (select 1 from public.children c
                  where c.id = p_child_id and c.photo_consent)
  ) s;

  select coalesce(jsonb_agg(inv order by period desc), '[]'::jsonb)
  into v_invoices
  from (
    select jsonb_build_object(
      'id', b.invoice_id, 'period', b.period, 'total', b.total,
      'paid', b.paid, 'balance', b.balance
    ) as inv, b.period
    from public.invoice_balances b
    where b.child_id = p_child_id and b.status = 'issued'
    order by b.period desc
    limit 12
  ) s;

  select coalesce(jsonb_agg(pr order by created_at desc), '[]'::jsonb)
  into v_proofs
  from (
    select jsonb_build_object(
      'id', p.id, 'amount', p.amount, 'method', p.method,
      'proof_status', p.proof_status, 'rejection_reason', p.rejection_reason,
      'created_at', p.created_at
    ) as pr, p.created_at
    from public.payments p
    where p.child_id = p_child_id
      and p.guardian_id = tok.guardian_id
      and p.source = 'portal'
      and p.proof_status in ('pending', 'rejected')
    order by p.created_at desc
    limit 5
  ) s;

  select pickup_code_enabled into v_code_enabled
  from public.nursery_settings where nursery_id = tok.nursery_id;
  if coalesce(v_code_enabled, false) and p_date = current_date then
    select code into v_pickup_code from public.pickup_codes
    where child_id = p_child_id and day_date = p_date;
    if v_pickup_code is null then
      v_pickup_code := public.generate_pickup_code();
      insert into public.pickup_codes (nursery_id, child_id, day_date, code)
      values (tok.nursery_id, p_child_id, p_date, v_pickup_code)
      on conflict (child_id, day_date) do nothing;
      select code into v_pickup_code from public.pickup_codes
      where child_id = p_child_id and day_date = p_date;
    end if;
  end if;

  return jsonb_build_object(
    'attendance', v_attendance,
    'report', v_report,
    'photos', v_photos,
    'invoices', v_invoices,
    'proofs', v_proofs,
    'pickup_code', v_pickup_code
  );
end $$;
grant execute on function public.nursery_portal_child_day_by_token(text, uuid, date) to anon, authenticated;
