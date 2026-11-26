import { requireSupabase } from './supabase'

/**
 * بوابة حوكمة الذكاء الاصطناعي (4.15): أي سطح ذكاء مستقبلي في
 * نونو يمر من هنا — ‏aiAllowed قبل النداء وlogAiUsage بعده.
 * القاعدة: لا سطح يعمل لحضانة بلا سقف مفعّل، ولا إنفاق يتجاوز
 * السقف الشهري. لا نداءات فعلية بعد (مفاتيح المزود قرار مالك)
 * — docs/AI-GOVERNANCE.md.
 */
export async function aiAllowed(
  nurseryId: string,
): Promise<{ allowed: boolean; reason: string }> {
  const db = requireSupabase()
  const { data: cap, error } = await db
    .from('ai_spend_caps')
    .select('monthly_cap_micro, enabled')
    .eq('nursery_id', nurseryId)
    .maybeSingle()
  if (error) throw error
  if (!cap) return { allowed: false, reason: 'no_cap' }
  const row = cap as { monthly_cap_micro: number; enabled: boolean }
  if (!row.enabled) return { allowed: false, reason: 'disabled' }
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const { data: usage, error: usageError } = await db
    .from('ai_usage_log')
    .select('cost_micro')
    .eq('nursery_id', nurseryId)
    .gte('created_at', monthStart.toISOString())
  if (usageError) throw usageError
  const spent = (usage ?? []).reduce(
    (sum, r) => sum + Number((r as { cost_micro: number }).cost_micro),
    0,
  )
  if (spent >= row.monthly_cap_micro)
    return { allowed: false, reason: 'cap_reached' }
  return { allowed: true, reason: 'ok' }
}
