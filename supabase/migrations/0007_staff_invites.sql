-- ============================================================================
-- نونو — 0007_staff_invites.sql
-- دعوات الطاقم بالبريد (نمط دعوات المدرس 0006 هناك): المالك يضيف مشرفة
-- ببريدها وصلاحياتها قبل ما يكون لها حساب؛ أول دخول لها بأي طريقة مصادقة
-- بنفس البريد «يدّعي» الدعوة فتتحول لعضوية فعّالة تلقائياً.
-- ============================================================================

begin;

alter table public.nursery_members
  alter column user_id drop not null,
  add column invited_email text;

-- عضوية مدعوة واحدة لكل بريد داخل الحضانة
create unique index nursery_members_invite_email_idx
  on public.nursery_members (nursery_id, invited_email)
  where invited_email is not null;

-- ادعاء الدعوات المعلّقة ببريد المستخدم الحالي — تُستدعى عند حلّ الهوية
create or replace function public.claim_nursery_invites()
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_count int;
begin
  if v_uid is null then
    return 0;
  end if;
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    return 0;
  end if;
  update public.nursery_members
  set user_id = v_uid, status = 'active', invited_email = null
  where invited_email is not null
    and lower(invited_email) = lower(v_email)
    and status = 'invited';
  get diagnostics v_count = row_count;
  return v_count;
end $$;
grant execute on function public.claim_nursery_invites() to authenticated;

commit;
