-- طرق الدفع على الصفحة العامة (مهمة 1.8): بيانات دفع الحضانة
-- نفسها معلنة بقرار مالكها — المال يذهب للحضانة مباشرة ولا يمر
-- عبر نونو أبداً (ضمان منشور على الصفحة). رفع الإثبات يبقى في
-- بوابة ولي الأمر (هوية موثقة بالتوكن) كما هو منذ فيز 1.
alter table public.nurseries
  add column public_instapay text,
  add column public_vodafone text,
  add column public_bank text;

create or replace function public.nursery_public_page(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n public.nurseries;
  v_classes jsonb;
begin
  select * into n from public.nurseries
  where public_slug = p_slug and public_enabled = true;
  if n.id is null then
    return jsonb_build_object('found', false);
  end if;
  select coalesce(jsonb_agg(c order by fee), '[]'::jsonb)
  into v_classes
  from (
    select jsonb_build_object(
      'name', cl.name,
      'fee', cl.monthly_fee,
      'capacity', cl.capacity,
      'available', case
        when cl.capacity is null then null
        else greatest(cl.capacity - count(e.id), 0)
      end
    ) as c, cl.monthly_fee as fee
    from public.classes cl
    left join public.enrollments e
      on e.class_id = cl.id and e.status = 'active'
    where cl.nursery_id = n.id and cl.archived_at is null
    group by cl.id, cl.name, cl.monthly_fee, cl.capacity
  ) x;
  return jsonb_build_object(
    'found', true,
    'name', n.name,
    'about', n.public_about,
    'address', n.address,
    'phone', n.phone,
    'logo_url', n.logo_url,
    'licensed', n.public_license_no is not null
      and char_length(btrim(n.public_license_no)) > 0,
    'payments', jsonb_build_object(
      'instapay', n.public_instapay,
      'vodafone', n.public_vodafone,
      'bank', n.public_bank
    ),
    'classes', v_classes
  );
end $$;
revoke execute on function public.nursery_public_page(text) from public;
grant execute on function public.nursery_public_page(text)
  to anon, authenticated;
