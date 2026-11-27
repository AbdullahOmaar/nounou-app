/**
 * بث موقع الباص الحي من شاشة الطاقم (3A-414، هجرة 0060).
 * البث صريح: بدء/إنهاء يدويان، والموقع يُرسل مثبّطاً (≥ 10 ثوانٍ بين
 * إرسال وآخر) عبر دوال RPC المحروسة — لا أثر دائم إلا حدثا البدء/الإنهاء.
 */
import { useEffect, useRef, useState } from 'react'
import { requireSupabase } from '../../lib/supabase'
import type { BusDirection } from '../../types/database'

export interface BusLiveSession {
  id: string
  nursery_id: string
  route_id: string
  list_id: string
  direction: BusDirection
  started_by: string | null
  started_at: string
  ended_at: string | null
  last_lat: number | null
  last_lng: number | null
  last_loc_at: string | null
  created_at: string
}

/** أقصى معدل إرسال: موقع كل 10 ثوانٍ كحد أدنى بين إرسالين */
export const LIVE_SEND_INTERVAL_MS = 10_000

export async function getActiveLiveSession(
  listId: string,
): Promise<BusLiveSession | null> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('bus_live_sessions')
    .select('*')
    .eq('list_id', listId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as BusLiveSession | null
}

export async function startLiveSession(listId: string): Promise<BusLiveSession> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('bus_live_start', { p_list_id: listId })
  if (error) throw error
  return data as BusLiveSession
}

export async function updateLivePosition(
  sessionId: string,
  lat: number,
  lng: number,
): Promise<BusLiveSession> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('bus_live_update', {
    p_session_id: sessionId,
    p_lat: lat,
    p_lng: lng,
  })
  if (error) throw error
  return data as BusLiveSession
}

export async function endLiveSession(sessionId: string): Promise<BusLiveSession> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('bus_live_end', { p_session_id: sessionId })
  if (error) throw error
  return data as BusLiveSession
}

export type LiveGeoError = 'unsupported' | 'denied' | 'unavailable' | 'timeout'

/**
 * بث الموقع أثناء جلسة نشطة: watchPosition + إرسال مثبّط.
 * يُعاد ضبط المراقبة عند تغيّر الجلسة؛ ويتوقف تلقائياً عند إنهائها.
 */
export function useLiveBroadcast(sessionId: string | null): {
  lastSentAt: string | null
  geoError: LiveGeoError | null
} {
  const [lastSentAt, setLastSentAt] = useState<string | null>(null)
  const [geoError, setGeoError] = useState<LiveGeoError | null>(null)
  const lastSentRef = useRef(0)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId

  useEffect(() => {
    if (!sessionId) return undefined
    if (!('geolocation' in navigator)) {
      setGeoError('unsupported')
      return undefined
    }
    setGeoError(null)
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (now - lastSentRef.current < LIVE_SEND_INTERVAL_MS) return
        lastSentRef.current = now
        void updateLivePosition(
          sessionRef.current!,
          pos.coords.latitude,
          pos.coords.longitude,
        )
          .then((s) => setLastSentAt(s.last_loc_at))
          .catch(() => {
            // فشل إرسال واحد لا يوقف البث — المحاولة التالية بعد 10 ثوانٍ.
          })
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'unavailable'
              : 'timeout',
        )
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [sessionId])

  return { lastSentAt, geoError }
}
