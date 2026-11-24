import { requireSupabase } from '../../lib/supabase'

export interface WhatsAppConfig {
  nursery_id: string
  phone_number_id: string | null
  display_phone: string | null
  template_status: 'none' | 'submitted' | 'approved'
  enabled: boolean
}

export interface WhatsAppLogRow {
  id: string
  template: string
  status: string
  created_at: string
}

export async function getWhatsAppConfig(
  nurseryId: string,
): Promise<WhatsAppConfig | null> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nursery_whatsapp_config')
    .select('*')
    .eq('nursery_id', nurseryId)
    .maybeSingle()
  if (error) throw error
  return (data as WhatsAppConfig | null) ?? null
}

export async function saveWhatsAppConfig(
  nurseryId: string,
  actorId: string | null,
  input: Omit<WhatsAppConfig, 'nursery_id'>,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_whatsapp_config').upsert({
    nursery_id: nurseryId,
    phone_number_id: input.phone_number_id,
    display_phone: input.display_phone,
    template_status: input.template_status,
    enabled: input.enabled,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function whatsAppGate(nurseryId: string): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('whatsapp_gate_check', {
    p_nursery: nurseryId,
  })
  if (error) throw error
  return data as string
}

export async function whatsAppEnqueueTest(nurseryId: string): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('whatsapp_enqueue', {
    p_nursery: nurseryId,
    p_guardian: null,
    p_template: 'gate_test',
    p_params: {},
  })
  if (error) throw error
  return data as string
}

export async function listWhatsAppLog(
  nurseryId: string,
): Promise<WhatsAppLogRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('whatsapp_send_log')
    .select('id, template, status, created_at')
    .eq('nursery_id', nurseryId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) throw error
  return (data ?? []) as WhatsAppLogRow[]
}

/** يرسل كود استلام اليوم للوصيّ الدافع عبر البوابات (2.4) */
export async function enqueuePickupCode(
  nurseryId: string,
  childId: string,
  code: string,
): Promise<string> {
  const db = requireSupabase()
  const { data: link, error: lErr } = await db
    .from('guardian_children')
    .select('guardian_id')
    .eq('child_id', childId)
    .eq('is_payer', true)
    .maybeSingle()
  if (lErr) throw lErr
  const { data, error } = await db.rpc('whatsapp_enqueue', {
    p_nursery: nurseryId,
    p_guardian: link?.guardian_id ?? null,
    p_template: 'pickup_code',
    p_params: { code },
  })
  if (error) throw error
  return data as string
}
