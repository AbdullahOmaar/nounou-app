-- ============================================================
-- بذرة الديمو — بيانات وهمية واضحة فقط (أسماء «تجريبي/ة» وأرقام
-- موبايل مصنوعة) لحساب الديمو العام demo@nounou-app.com.
-- تُشغَّل مرة واحدة عند التفعيل (docs/ACTIVATION.md خطوة ٦) بعد
-- إنشاء مستخدم الديمو في Auth — استبدل {{DEMO_USER_ID}} بمعرّفه.
-- آمنة لإعادة التشغيل: كل إدراج محروس بـ on conflict / not exists.
-- ============================================================

begin;

-- ملحوظة بروفة 3A-334: البريد يعيش في auth.users فقط — جدول public.users
-- بلا عمود email؛ إدراجه هنا كان يوقف البذرة كلها عند أول بيان.
insert into public.users (id, display_name)
values ('{{DEMO_USER_ID}}', 'مالك تجريبي')
on conflict (id) do nothing;

insert into public.nurseries (id, name, phone, address, created_by)
values (
  '11111111-1111-4111-8111-111111111111',
  'حضانة نونو التجريبية',
  '01000000000',
  'عنوان تجريبي — القاهرة',
  '{{DEMO_USER_ID}}'
)
on conflict (id) do nothing;

insert into public.nursery_members (nursery_id, user_id, role, status, permissions)
values (
  '11111111-1111-4111-8111-111111111111',
  '{{DEMO_USER_ID}}',
  'owner', 'active', '{}'::jsonb
)
on conflict (nursery_id, user_id) do nothing;

insert into public.nursery_settings (nursery_id)
values ('11111111-1111-4111-8111-111111111111')
on conflict (nursery_id) do nothing;

-- الفصول (باقات شهرية + أعمار بالسنوات)
insert into public.classes (id, nursery_id, name, monthly_fee, capacity, age_from, age_to, nap_enabled, sort_order)
values
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'البراعم', 700, 15, 2, 3, true, 1),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'الزهور', 800, 20, 3, 4, true, 2),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111111', 'الفراشات', 900, 20, 4, 6, false, 3)
on conflict (id) do nothing;

-- أولياء أمور وهميون (أرقام مصنوعة بصيغة صحيحة)
insert into public.guardians (id, nursery_id, full_name, phone, relation)
values
  ('33333333-3333-4333-8333-333333333331', '11111111-1111-4111-8111-111111111111', 'أحمد تجريبي', '01001112223', 'father'),
  ('33333333-3333-4333-8333-333333333332', '11111111-1111-4111-8111-111111111111', 'سارة تجريبية', '01001112224', 'mother'),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'محمود تجريبي', '01001112225', 'father')
on conflict (id) do nothing;

-- أطفال وهميون (يوسف ومريم إخوات — نفس الوصي الدافع)
insert into public.children (id, nursery_id, full_name, birth_date, gender, photo_consent)
values
  ('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', 'يوسف تجريبي', '2023-06-15', 'male', true),
  ('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111111', 'مريم تجريبية', '2022-02-10', 'female', true),
  ('44444444-4444-4444-8444-444444444443', '11111111-1111-4111-8111-111111111111', 'ليان تجريبية', '2023-09-01', 'female', true),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'عمر تجريبي', '2021-12-05', 'male', false),
  ('44444444-4444-4444-8444-444444444445', '11111111-1111-4111-8111-111111111111', 'نور تجريبية', '2022-07-20', 'female', true)
on conflict (id) do nothing;

insert into public.guardian_children (guardian_id, child_id, is_payer)
values
  ('33333333-3333-4333-8333-333333333331', '44444444-4444-4444-8444-444444444441', true),
  ('33333333-3333-4333-8333-333333333331', '44444444-4444-4444-8444-444444444442', true),
  ('33333333-3333-4333-8333-333333333332', '44444444-4444-4444-8444-444444444443', true),
  ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', true),
  ('33333333-3333-4333-8333-333333333332', '44444444-4444-4444-8444-444444444445', true)
on conflict (guardian_id, child_id) do nothing;

-- حارس not exists (لا قيد فريد طبيعياً على الجدول — بروفة 3A-334 أثبتت
-- أن on conflict وحده يكرر الصف عند إعادة تشغيل البذرة)
insert into public.pickup_persons (nursery_id, child_id, full_name, relation, phone)
select
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444441',
  'جدة تجريبية',
  'grandparent'::public.pickup_relation,
  '01001112226'
where not exists (
  select 1 from public.pickup_persons p
  where p.child_id = '44444444-4444-4444-8444-444444444441'
    and p.phone = '01001112226'
);

-- تسجيلات نشطة في الفصول
insert into public.enrollments (nursery_id, child_id, class_id, status, starts_on)
values
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', '22222222-2222-4222-8222-222222222221', 'active', current_date - 30),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', '22222222-2222-4222-8222-222222222222', 'active', current_date - 30),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', '22222222-2222-4222-8222-222222222221', 'active', current_date - 30),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222223', 'active', current_date - 30),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444445', '22222222-2222-4222-8222-222222222222', 'active', current_date - 30)
on conflict do nothing;

-- خط باص تجريبي + اشتراكان (رسوم الاشتراك على الاشتراك نفسه)
insert into public.bus_routes (id, nursery_id, name)
values ('55555555-5555-4555-8555-555555555551', '11111111-1111-4111-8111-111111111111', 'خط المعادي التجريبي')
on conflict (id) do nothing;

insert into public.bus_subscriptions (nursery_id, child_id, route_id, monthly_fee, is_active)
values
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', '55555555-5555-4555-8555-555555555551', 300, true),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', '55555555-5555-4555-8555-555555555551', 300, true)
on conflict (child_id, route_id) do nothing;

-- فاتورة الشهر الماضي ليوسف (أساس + باص) ودفعة كاملة بإيصال رقم ١
insert into public.invoices (id, nursery_id, child_id, period, status, created_by)
values (
  '66666666-6666-4666-8666-666666666661',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444441',
  to_char(current_date - interval '1 month', 'YYYY-MM'),
  'issued',
  '{{DEMO_USER_ID}}'
)
on conflict (id) do nothing;

-- حارس not exists لكل سطر (لا قيد فريد على بنود الفاتورة — بروفة 3A-334
-- أثبتت أن إعادة التشغيل كانت تضاعف إجمالي الفاتورة 1000 ← 2000)
insert into public.invoice_lines (nursery_id, invoice_id, type, label, amount)
select v.nursery_id, v.invoice_id, v.type, v.label, v.amount
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, '66666666-6666-4666-8666-666666666661'::uuid, 'base'::public.invoice_line_type, 'باقة فصل البراعم', 700::numeric),
  ('11111111-1111-4111-8111-111111111111'::uuid, '66666666-6666-4666-8666-666666666661'::uuid, 'bus'::public.invoice_line_type, 'باص: خط المعادي التجريبي', 300::numeric)
) as v(nursery_id, invoice_id, type, label, amount)
where not exists (
  select 1 from public.invoice_lines l
  where l.invoice_id = v.invoice_id and l.type = v.type and l.label = v.label
);

insert into public.receipt_counters (nursery_id, last_no)
values ('11111111-1111-4111-8111-111111111111', 1)
on conflict (nursery_id) do update set last_no = greatest(public.receipt_counters.last_no, 1);

insert into public.payments (nursery_id, child_id, invoice_id, amount, method, paid_at, receipt_no, proof_status, source, recorded_by)
values (
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444441',
  '66666666-6666-4666-8666-666666666661',
  1000, 'cash', current_date - 20, 1, 'not_required', 'admin',
  '{{DEMO_USER_ID}}'
)
on conflict do nothing;

-- يوم اليوم لفصل البراعم: وصول طفلين + تقرير منشور ليوسف
insert into public.class_days (id, nursery_id, class_id, day_date)
values (
  '77777777-7777-4777-8777-777777777771',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222221',
  current_date
)
on conflict (class_id, day_date) do nothing;

insert into public.attendance (nursery_id, class_day_id, child_id, status, arrived_at, arrived_by)
select
  '11111111-1111-4111-8111-111111111111',
  cd.id,
  c.child_id,
  'present',
  current_date + time '08:15',
  '{{DEMO_USER_ID}}'
from public.class_days cd
join (values
  ('44444444-4444-4444-8444-444444444441'::uuid),
  ('44444444-4444-4444-8444-444444444443'::uuid)
) as c(child_id) on true
where cd.class_id = '22222222-2222-4222-8222-222222222221' and cd.day_date = current_date
on conflict do nothing;

insert into public.daily_reports (nursery_id, class_day_id, child_id, meals, nap_from, nap_to, nap_slept, activities, mood, note, published_at, created_by)
select
  '11111111-1111-4111-8111-111111111111',
  cd.id,
  '44444444-4444-4444-8444-444444444441',
  '[{"slot":"breakfast","amount":"all","source":"home"},{"slot":"snack","amount":"most","source":"home"}]'::jsonb,
  '11:00', '12:00', true,
  array['لعب حر', 'رسم'],
  'happy',
  'يوم جميل تجريبي',
  now(),
  '{{DEMO_USER_ID}}'
from public.class_days cd
where cd.class_id = '22222222-2222-4222-8222-222222222221' and cd.day_date = current_date
on conflict (class_day_id, child_id) do nothing;

commit;
