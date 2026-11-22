-- ============================================================================
-- نونو — 0010_portal_proofs_in_day.sql
-- يوم الطفل في البوابة يحتاج حالة إثباتات وليّ الأمر نفسه (معلّقة/مرفوضة
-- بسببها) — تُضاف لمخرجات nursery_portal_child_day_by_token كحقل proofs:
-- إثباتات هذا الوصي لهذا الطفل بحالة pending أو rejected (الأحدث أولاً).
-- ============================================================================

begin;

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

  select coalesce(jsonb_agg(pr order by pr.created_at desc), '[]'::jsonb)
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

commit;
