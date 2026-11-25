import { requireSupabase } from '../../lib/supabase'

export interface OpsNurseryRow {
  nursery_id: string
  name: string
  created_at: string
  children: number
  members: number
  invoices_month: number
  last_activity: string | null
}

export async function fetchPlatformOverview(): Promise<OpsNurseryRow[]> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('platform_overview')
  if (error) throw error
  return (data ?? []) as OpsNurseryRow[]
}

export async function checkIsOperator(): Promise<boolean> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('is_platform_operator')
  if (error) return false
  return data === true
}
