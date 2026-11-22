-- ============================================================================
-- نونو — 0006_portal.sql
-- بوابة ولي الأمر: توكنات موقعة hash-only + دوال RPC محروسة.
--
-- نموذج الأمان (منقول من بوابة المدرس المُثبتة 0001–0003 + دروس 0002 هناك):
-- • التوكن الخام لا يُخزَّن أبداً — SHA-256 hex فقط؛ العميل يولّد الخام
--   ويحسب هاشه بـ WebCrypto قبل الإدراج.
-- • لا سياسة anon على أي جدول — كل وصول ولي الأمر عبر RPCs ‏security definer
--   تتحقق من (الهاش + عدم الإلغاء + عدم الانتهاء + علاقة الوصي بالطفل).
-- • الدوال الداخلية بلا تحقق تُسحب صلاحيتها من anon/authenticated صراحة
--   (درس المدرس 0002: المنح الضمني في Supabase لا يكفي معه revoke from public).
-- • search_path يشمل extensions لأن digest() من pgcrypto هناك (درس 0002).
-- • صور البوابة: الـ RPC يعيد بيانات وصفية فقط؛ الرابط الموقع القصير يولّده
--   خادمياً Edge Function ‏portal-media عبر دالة nursery_portal_photo_path
--   الممنوحة لـ service_role فقط، وبفحص موافقة التصوير لحظة الطلب.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- توكنات وصول الأوصياء (توكن لكل وصي — قرار ق١٠؛ child_id فارغ = كل أطفاله)
-- ----------------------------------------------------------------------------
create table public.guardian_access_tokens (
  id           uuid primary key default gen_random_uuid(),
  nursery_id   uuid not null references public.nurseries (id) on delete cascade,
  guardian_id  uuid not null references public.guardians (id) on delete cascade,
  child_id     uuid references public.children (id) on delete cascade,
  token_hash   text not null unique,
  label        text,
  expires_at   timestamptz not null default (now() + interval '30 days'),
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create index guardian_tokens_guardian_idx on public.guardian_access_tokens (guardian_id, revoked_at);

alter table public.guardian_access_tokens enable row level security;
create policy guardian_tokens_member_select on public.guardian_access_tokens for select
  using (public.is_nursery_member(nursery_id));
create policy guardian_tokens_manage_write on public.guardian_access_tokens for insert
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));
create policy guardian_tokens_manage_update on public.guardian_access_tokens for update
  using (public.member_has_permission(nursery_id, 'can_manage_children'))
  with check (public.member_has_permission(nursery_id, 'can_manage_children'));

-- ----------------------------------------------------------------------------
-- حارس التوكن الداخلي: يعيد صف التوكن أو يرفع استثناء. بلا منح للعامة.
-- ----------------------------------------------------------------------------
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
  update public.guardian_access_tokens set last_used_at = now() where id = tok.id;
  return tok;
end $$;
revoke execute on function public.portal_token_resolve(text) from public, anon, authenticated;

-- تحقق أن التوكن يشمل هذا الطفل (توكن طفل محدد أو وصيّ الطفل)
create or replace function public.portal_token_covers_child(
  p_tok public.guardian_access_tokens, p_child_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select (p_tok.child_id is null or p_tok.child_id = p_child_id)
     and exists (
       select 1 from public.guardian_children gc
       where gc.guardian_id = p_tok.guardian_id and gc.child_id = p_child_id
     );
$$;
revoke execute on function public.portal_token_covers_child(public.guardian_access_tokens, uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- نظرة البوابة العامة: الحضانة + الوصي + أطفاله بأرصدتهم + آخر الإعلانات
-- ----------------------------------------------------------------------------
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

  select coalesce(jsonb_agg(a order by a.published_at desc), '[]'::jsonb)
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

-- ----------------------------------------------------------------------------
-- يوم الطفل: حضور/استلام + التقرير المنشور + صور اليوم (بيانات وصفية) +
-- كشف حساب الطفل + كود الاستلام اليومي عند تفعيله
-- ----------------------------------------------------------------------------
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
    'picked_up_by_name', pp.full_name
  ) into v_attendance
  from public.attendance a
  join public.class_days cd on cd.id = a.class_day_id and cd.day_date = p_date
  left join public.pickup_persons pp on pp.id = a.picked_up_by
  where a.child_id = p_child_id;

  select jsonb_build_object(
    'meals', r.meals, 'nap_from', r.nap_from, 'nap_to', r.nap_to,
    'nap_slept', r.nap_slept, 'activities', r.activities,
    'mood', r.mood, 'note', r.note, 'published_at', r.published_at
  ) into v_report
  from public.daily_reports r
  join public.class_days cd on cd.id = r.class_day_id and cd.day_date = p_date
  where r.child_id = p_child_id and r.published_at is not null;

  -- الصور: بيانات وصفية فقط وبموافقة تصوير سارية (الروابط من portal-media)
  select coalesce(jsonb_agg(p order by p.created_at), '[]'::jsonb)
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

  select coalesce(jsonb_agg(inv order by inv.period desc), '[]'::jsonb)
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
    'pickup_code', v_pickup_code
  );
end $$;
grant execute on function public.nursery_portal_child_day_by_token(text, uuid, date) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- دفع من البوابة بإثبات: ينشئ دفعة pending بمسار إثبات يولّده الخادم
-- ----------------------------------------------------------------------------
create or replace function public.nursery_portal_submit_payment(
  p_token text, p_child_id uuid, p_amount numeric, p_method payment_method, p_ext text)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
  v_payment_id uuid;
  v_path text;
  v_ext text;
begin
  tok := public.portal_token_resolve(p_token);
  if not public.portal_token_covers_child(tok, p_child_id) then
    raise exception 'not authorized';
  end if;
  if p_method = 'cash' then
    raise exception 'cash has no proof';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  v_ext := case when lower(coalesce(p_ext, '')) in ('png', 'webp') then lower(p_ext) else 'jpg' end;

  insert into public.payments (
    nursery_id, child_id, amount, method, proof_status, source, guardian_id)
  values (tok.nursery_id, p_child_id, p_amount, p_method, 'pending', 'portal', tok.guardian_id)
  returning id into v_payment_id;

  v_path := tok.nursery_id::text || '/' || v_payment_id::text || '.' || v_ext;
  update public.payments set proof_path = v_path where id = v_payment_id;

  return jsonb_build_object('payment_id', v_payment_id, 'proof_path', v_path);
end $$;
grant execute on function public.nursery_portal_submit_payment(text, uuid, numeric, payment_method, text)
  to anon, authenticated;

-- تأكيد أن الصورة رُفعت فعلاً (بعد نجاح رفع التخزين من العميل)
create or replace function public.nursery_portal_confirm_proof(p_token text, p_payment_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
begin
  tok := public.portal_token_resolve(p_token);
  update public.payments
  set proof_confirmed_at = now()
  where id = p_payment_id
    and nursery_id = tok.nursery_id
    and guardian_id = tok.guardian_id
    and proof_status = 'pending';
  if not found then
    raise exception 'not authorized';
  end if;
end $$;
grant execute on function public.nursery_portal_confirm_proof(text, uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- مسار صورة لوسائط البوابة — service_role فقط (Edge Function ‏portal-media)
-- يتحقق: توكن صالح + الصورة مرتبطة بطفل الوصي + موافقة تصوير سارية.
-- ----------------------------------------------------------------------------
create or replace function public.nursery_portal_photo_path(p_token text, p_photo_id uuid)
returns text language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  tok public.guardian_access_tokens;
  v_path text;
begin
  tok := public.portal_token_resolve(p_token);
  select ph.storage_path into v_path
  from public.child_photos ph
  where ph.id = p_photo_id
    and ph.nursery_id = tok.nursery_id
    and exists (
      select 1 from public.photo_children pc
      join public.children c on c.id = pc.child_id and c.photo_consent
      where pc.photo_id = ph.id
        and public.portal_token_covers_child(tok, pc.child_id)
    );
  if v_path is null then
    raise exception 'not authorized';
  end if;
  return v_path;
end $$;
revoke execute on function public.nursery_portal_photo_path(text, uuid) from public, anon, authenticated;
grant execute on function public.nursery_portal_photo_path(text, uuid) to service_role;

commit;
