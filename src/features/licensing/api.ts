import { requireSupabase } from '../../lib/supabase'
import type { LicensingStepStatus } from './steps'

export async function listStepStatuses(
  nurseryId: string,
): Promise<Map<string, LicensingStepStatus>> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('licensing_steps')
    .select('step_key, status')
    .eq('nursery_id', nurseryId)
  if (error) throw error
  return new Map(
    (data ?? []).map((r) => [
      (r as { step_key: string }).step_key,
      (r as { status: LicensingStepStatus }).status,
    ]),
  )
}

export async function setStepStatus(
  nurseryId: string,
  stepKey: string,
  status: LicensingStepStatus,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('licensing_steps').upsert(
    {
      nursery_id: nurseryId,
      step_key: stepKey,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'nursery_id,step_key' },
  )
  if (error) throw error
}
