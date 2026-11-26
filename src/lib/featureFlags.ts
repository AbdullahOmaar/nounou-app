import { requireSupabase } from './supabase'

/**
 * أعلام الميزات (4.21): التفعيل التدريجي الصريح لكل حضانة.
 * القاعدة: غياب الصف = مطفأ — لا تفعيل صامت أبداً. كل ميزة
 * جديدة تُشحن خلف علم مطفأ وتُفعّل لحضانة بقرار موثق.
 * السجل الأولي في docs/INFRASTRUCTURE.md.
 */
export const KNOWN_FLAGS = ['supervisor_assistant'] as const
export type FlagKey = (typeof KNOWN_FLAGS)[number]

export async function isFlagEnabled(
  nurseryId: string,
  flag: FlagKey,
): Promise<boolean> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nursery_feature_flags')
    .select('enabled')
    .eq('nursery_id', nurseryId)
    .eq('flag_key', flag)
    .maybeSingle()
  if (error) throw error
  return (data as { enabled: boolean } | null)?.enabled === true
}

export async function setFlag(
  nurseryId: string,
  flag: FlagKey,
  enabled: boolean,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_feature_flags').upsert(
    {
      nursery_id: nurseryId,
      flag_key: flag,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'nursery_id,flag_key' },
  )
  if (error) throw error
}
