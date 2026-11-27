-- وصول العائلة الممتدة (مهمة 2.7): توكن مشاهدة فقط لكل وصيّ —
-- يقرأ اليوم والصور والكشف، ولا يدفع ولا يرسل رسائل ولا يؤكد
-- إثباتات. الحارس خادمي في كل RPC كتابة بالتوكن.
alter table public.guardian_access_tokens
  add column access_scope text not null default 'full'
  check (access_scope in ('full', 'view'));

CREATE OR REPLACE FUNCTION public.replace_guardian_portal_token(p_nursery uuid, p_guardian uuid, p_child uuid, p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  if not public.member_has_permission(p_nursery, 'can_manage_children') then
    raise exception 'not_authorized';
  end if;

  update public.guardian_access_tokens
     set revoked_at = now()
   where nursery_id = p_nursery
     and guardian_id = p_guardian
     and child_id is not distinct from p_child
     and revoked_at is null
     and access_scope = 'full';

  insert into public.guardian_access_tokens
    (nursery_id, guardian_id, child_id, token_hash, created_by)
  values (p_nursery, p_guardian, p_child, p_token_hash, auth.uid())
  returning id into v_id;

  return v_id;
end $function$;

-- إصدار رابط مشاهدة: يلغي روابط المشاهدة السابقة لنفس النطاق فقط
create or replace function public.issue_guardian_view_token(
  p_nursery uuid, p_guardian uuid, p_child uuid, p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.member_has_permission(p_nursery, 'can_manage_children') then
    raise exception 'not_authorized';
  end if;
  update public.guardian_access_tokens
     set revoked_at = now()
   where nursery_id = p_nursery
     and guardian_id = p_guardian
     and child_id is not distinct from p_child
     and revoked_at is null
     and access_scope = 'view';
  insert into public.guardian_access_tokens
    (nursery_id, guardian_id, child_id, token_hash, created_by, access_scope)
  values (p_nursery, p_guardian, p_child, p_token_hash, auth.uid(), 'view')
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.issue_guardian_view_token(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.issue_guardian_view_token(uuid, uuid, uuid, text)
  to authenticated;

CREATE OR REPLACE FUNCTION public.nursery_portal_submit_payment(p_token text, p_child_id uuid, p_amount numeric, p_method payment_method, p_ext text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  tok public.guardian_access_tokens;
  v_payment_id uuid;
  v_path text;
  v_ext text;
begin
  tok := public.portal_token_resolve(p_token);
  if tok.access_scope = 'view' then raise exception 'view_only'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.nursery_portal_confirm_proof(p_token text, p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  tok public.guardian_access_tokens;
begin
  tok := public.portal_token_resolve(p_token);
  if tok.access_scope = 'view' then raise exception 'view_only'; end if;
  update public.payments
  set proof_confirmed_at = now()
  where id = p_payment_id
    and nursery_id = tok.nursery_id
    and guardian_id = tok.guardian_id
    and proof_status = 'pending';
  if not found then
    raise exception 'not authorized';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.nursery_portal_cancel_payment(p_token text, p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  tok public.guardian_access_tokens;
begin
  tok := public.portal_token_resolve(p_token);
  if tok.access_scope = 'view' then raise exception 'view_only'; end if;
  delete from public.payments
  where id = p_payment_id
    and nursery_id = tok.nursery_id
    and guardian_id = tok.guardian_id
    and proof_status = 'pending'
    and proof_confirmed_at is null;
  if not found then
    raise exception 'not authorized';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.nursery_portal_send_message_by_token(p_token text, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  tok public.guardian_access_tokens;
  v_id uuid;
begin
  tok := public.portal_token_resolve(p_token);
  if tok.access_scope = 'view' then raise exception 'view_only'; end if;
  if p_body is null or char_length(trim(p_body)) = 0
     or char_length(p_body) > 2000 then
    raise exception 'bad_body';
  end if;
  insert into public.portal_messages (nursery_id, guardian_id, sender, body)
  values (tok.nursery_id, tok.guardian_id, 'guardian', trim(p_body))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $function$;

CREATE OR REPLACE FUNCTION public.nursery_portal_overview_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
    'access_scope', tok.access_scope,
    'nursery', (select jsonb_build_object('name', n.name, 'phone', n.phone)
                from public.nurseries n where n.id = tok.nursery_id),
    'guardian', (select jsonb_build_object('full_name', g.full_name)
                 from public.guardians g where g.id = tok.guardian_id),
    'children', v_children,
    'announcements', v_announcements
  );
end $function$;
