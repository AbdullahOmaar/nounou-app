import { requireSupabase } from '../../lib/supabase'
import { logActivityAuto } from '../settings/api'

export type EventKind = 'graduation' | 'open_day' | 'aqeeqa' | 'other'

export interface EventHall {
  name: string
  location_text: string | null
  maps_url: string | null
}

export interface NurseryEvent {
  id: string
  title: string
  kind: EventKind
  starts_at: string
  ends_at: string | null
  location_text: string | null
  maps_url: string | null
  public_code: string
  halls: EventHall[]
  created_at: string
}

export async function listEvents(nurseryId: string): Promise<NurseryEvent[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('nursery_events')
    .select('*')
    .eq('nursery_id', nurseryId)
    .order('starts_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as NurseryEvent[]
}

export async function createEvent(
  nurseryId: string,
  input: {
    title: string
    kind: EventKind
    startsAt: string
    endsAt: string | null
    locationText: string | null
    mapsUrl: string | null
    halls: EventHall[]
  },
): Promise<void> {
  const db = requireSupabase()
  const { data: userData } = await db.auth.getUser()
  const { error } = await db.from('nursery_events').insert({
    nursery_id: nurseryId,
    title: input.title.trim(),
    kind: input.kind,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    location_text: input.locationText,
    maps_url: input.mapsUrl,
    halls: input.halls,
    created_by: userData.user?.id ?? null,
  })
  if (error) throw error
  await logActivityAuto(nurseryId, 'event_created', input.title.trim())
}

export async function deleteEvent(id: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('nursery_events').delete().eq('id', id)
  if (error) throw error
}

export interface PublicEvent {
  found: boolean
  title?: string
  kind?: EventKind
  starts_at?: string
  ends_at?: string | null
  location_text?: string | null
  maps_url?: string | null
  halls?: EventHall[]
  nursery?: {
    name: string
    logo_url: string | null
    phone: string | null
    brand_color: string | null
  }
}

export async function fetchPublicEvent(code: string): Promise<PublicEvent> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('public_event_by_code', {
    p_code: code,
  })
  if (error) throw error
  return data as PublicEvent
}
