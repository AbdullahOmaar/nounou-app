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

export interface PublicNurseryEvent {
  title: string
  kind: EventKind
  starts_at: string
  public_code: string
  location_text: string | null
}

export async function fetchPublicNurseryEvents(
  slug: string,
): Promise<PublicNurseryEvent[]> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('public_nursery_events', {
    p_slug: slug,
  })
  if (error) throw error
  const res = data as { found: boolean; events?: PublicNurseryEvent[] }
  return res.found ? (res.events ?? []) : []
}

export interface EventPhoto {
  id: string
  storage_path: string
  caption: string | null
  url: string | null
}

export async function listEventPhotos(eventId: string): Promise<EventPhoto[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('event_photos')
    .select('id, storage_path, caption')
    .eq('event_id', eventId)
    .order('created_at')
  if (error) throw error
  const rows = (data ?? []) as Omit<EventPhoto, 'url'>[]
  return Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await db.storage
        .from('child-media')
        .createSignedUrl(r.storage_path, 3600)
      return { ...r, url: signed?.signedUrl ?? null }
    }),
  )
}

export async function addEventPhoto(
  nurseryId: string,
  eventId: string,
  file: File,
): Promise<void> {
  const { compressImage } = await import('../reports/photoUtils')
  const db = requireSupabase()
  const blob = await compressImage(file)
  const photoId = crypto.randomUUID()
  const path = `${nurseryId}/events/${photoId}.jpg`
  const { error: upErr } = await db.storage
    .from('child-media')
    .upload(path, blob, { contentType: 'image/jpeg' })
  if (upErr) throw upErr
  const { error } = await db.from('event_photos').insert({
    id: photoId,
    nursery_id: nurseryId,
    event_id: eventId,
    storage_path: path,
  })
  if (error) throw error
}

export async function deleteEventPhoto(photo: EventPhoto): Promise<void> {
  const db = requireSupabase()
  await db.storage.from('child-media').remove([photo.storage_path])
  const { error } = await db
    .from('event_photos')
    .delete()
    .eq('id', photo.id)
  if (error) throw error
}
