import { requireSupabase } from '../../lib/supabase'
import type { GuardianAccessTokenRow, PaymentMethod } from '../../types/database'

/* ------------------------------------------------------------------ */
/* إدارة الروابط (طاقم الحضانة)                                        */
/* ------------------------------------------------------------------ */

/** توليد توكن خام (٣٢ بايت عشوائي hex) — يُعرض مرة واحدة ولا يُخزَّن */
export function generateRawToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** هاش SHA-256 hex — ما يُخزَّن في القاعدة فقط (hash-only) */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function portalUrl(rawToken: string): string {
  return `${window.location.origin}/p/${rawToken}`
}

export async function listTokens(
  nurseryId: string,
  guardianId?: string,
): Promise<GuardianAccessTokenRow[]> {
  const db = requireSupabase()
  let query = db
    .from('guardian_access_tokens')
    .select('*')
    .eq('nursery_id', nurseryId)
    .order('created_at', { ascending: false })
  if (guardianId) query = query.eq('guardian_id', guardianId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as GuardianAccessTokenRow[]
}

/** إصدار رابط: يخزن الهاش فقط ويعيد الرابط الكامل للعرض/النسخ مرة واحدة */
export async function issueToken(
  nurseryId: string,
  guardianId: string,
  childId: string | null,
  actorId: string | null,
): Promise<string> {
  const db = requireSupabase()
  const raw = generateRawToken()
  const hash = await hashToken(raw)
  const { error } = await db.from('guardian_access_tokens').insert({
    nursery_id: nurseryId,
    guardian_id: guardianId,
    child_id: childId,
    token_hash: hash,
    created_by: actorId,
  })
  if (error) throw error
  return portalUrl(raw)
}

export async function revokeToken(tokenId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('guardian_access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('revoked_at', null)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* البوابة العامة (ولي الأمر — بلا حساب، بالتوكن فقط عبر RPCs)          */
/* ------------------------------------------------------------------ */

export interface PortalChild {
  id: string
  full_name: string
  photo_consent: boolean
  class_name: string | null
  balance: number
  total_paid: number
}

export interface PortalOverview {
  nursery: { name: string; phone: string | null }
  guardian: { full_name: string }
  children: PortalChild[]
  announcements: { id: string; title: string; body: string; published_at: string }[]
}

export interface PortalDayPhoto {
  id: string
  caption: string | null
  created_at: string
}

export interface PortalChildDay {
  attendance: {
    status: string
    arrived_at: string | null
    picked_up_at: string | null
    picked_up_by_name: string | null
  } | null
  report: {
    meals: { meal: string; ate: string; source: string; note?: string }[]
    nap_from: string | null
    nap_to: string | null
    nap_slept: boolean | null
    activities: string[]
    mood: string | null
    note: string | null
    published_at: string
  } | null
  photos: PortalDayPhoto[]
  invoices: {
    id: string
    period: string
    total: number
    paid: number
    balance: number
  }[]
  proofs: {
    id: string
    amount: number
    method: string
    proof_status: 'pending' | 'rejected'
    rejection_reason: string | null
    created_at: string
  }[]
  pickup_code: string | null
}

export async function fetchPortalOverview(token: string): Promise<PortalOverview> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('nursery_portal_overview_by_token', {
    p_token: token,
  })
  if (error) throw error
  return data as PortalOverview
}

export async function fetchPortalChildDay(
  token: string,
  childId: string,
  date: string,
): Promise<PortalChildDay> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('nursery_portal_child_day_by_token', {
    p_token: token,
    p_child_id: childId,
    p_date: date,
  })
  if (error) throw error
  return data as PortalChildDay
}

/** رابط موقع لصورة يوم — عبر Edge Function ‏portal-media (تحقق خادمي كامل) */
export async function fetchPortalPhotoUrl(
  token: string,
  photoId: string,
): Promise<string | null> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!base || !anon) return null
  try {
    const res = await fetch(`${base}/functions/v1/portal-media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({ token, photo_id: photoId }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { url?: string }
    return body.url ?? null
  } catch {
    return null
  }
}

/**
 * دفع من البوابة بإثبات: RPC ينشئ الدفعة ومسار إثباتها → رفع الصورة
 * (سياسة anon المقيدة بالمسار) → RPC تأكيد الرفع. أي فشل في الرفع
 * يترك الدفعة غير مؤكدة فلا تظهر في مراجعة المالك أبداً.
 */
export async function submitPortalPayment(
  token: string,
  childId: string,
  amount: number,
  method: Exclude<PaymentMethod, 'cash'>,
  file: File,
): Promise<void> {
  const db = requireSupabase()
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const { data, error } = await db.rpc('nursery_portal_submit_payment', {
    p_token: token,
    p_child_id: childId,
    p_amount: amount,
    p_method: method,
    p_ext: ext,
  })
  if (error) throw error
  const { payment_id, proof_path } = data as {
    payment_id: string
    proof_path: string
  }
  const { error: upErr } = await db.storage
    .from('payment-proofs')
    .upload(proof_path, file, { upsert: false })
  if (upErr) throw upErr
  const { error: confErr } = await db.rpc('nursery_portal_confirm_proof', {
    p_token: token,
    p_payment_id: payment_id,
  })
  if (confErr) throw confErr
}
