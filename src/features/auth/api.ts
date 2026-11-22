import { requireSupabase } from '../../lib/supabase'
import { t } from '../../i18n'

/**
 * طبقة مصادقة نونو: بريد + كلمة مرور (Supabase Auth).
 * عند إنشاء حساب بجلسة فورية يُنشأ صف users فوراً؛ إنشاء الحضانة نفسها
 * عبر RPC ‏create_nursery من شاشة الإعداد (لا إنشاء ضمني هنا).
 */

export const DEMO_EMAIL = 'demo@nounou-app.com'
export const DEMO_PASSWORD = 'Demo123456'

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return t('auth.invalidCredentials')
  if (m.includes('already registered') || m.includes('already exists'))
    return t('auth.emailInUse')
  if (m.includes('password') && m.includes('short')) return t('auth.weakPassword')
  return message
}

export async function signIn(email: string, password: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw new Error(friendlyAuthError(error.message))
}

export async function signInDemo(): Promise<void> {
  await signIn(DEMO_EMAIL, DEMO_PASSWORD)
}

/** إنشاء حساب + صف users عند توفر جلسة فورية. يعيد true لو لزم تأكيد بريد */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<{ needsEmailConfirm: boolean }> {
  const db = requireSupabase()
  const { data, error } = await db.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: displayName.trim() } },
  })
  if (error) throw new Error(friendlyAuthError(error.message))
  if (data.user && data.session) {
    const { error: profileError } = await db.from('users').insert({
      id: data.user.id,
      display_name: displayName.trim(),
    })
    if (profileError) throw new Error(profileError.message)
    return { needsEmailConfirm: false }
  }
  return { needsEmailConfirm: true }
}

/** يضمن وجود صف users للمستخدم الحالي (حسابات ما قبل هذا التدفق) */
export async function ensureUserProfile(displayName?: string): Promise<void> {
  const db = requireSupabase()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return
  const { data: existing } = await db
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()
  if (!existing) {
    await db.from('users').insert({
      id: user.id,
      display_name:
        displayName ??
        (typeof user.user_metadata?.display_name === 'string'
          ? user.user_metadata.display_name
          : ''),
    })
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw new Error(friendlyAuthError(error.message))
}

export async function updatePassword(password: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.auth.updateUser({ password })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/** إنشاء حضانة ذرّياً عبر RPC الأساس (حضانة + مالك + إعدادات) */
export async function createNursery(name: string): Promise<string> {
  const db = requireSupabase()
  await ensureUserProfile()
  const { data, error } = await db.rpc('create_nursery', { p_name: name })
  if (error) throw new Error(error.message)
  return data as string
}
