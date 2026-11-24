import { requireSupabase } from '../../lib/supabase'

export interface PublicClass {
  name: string
  fee: number
  capacity: number | null
  available: number | null
}

export interface PublicPageData {
  found: boolean
  name?: string
  about?: string | null
  address?: string | null
  phone?: string | null
  logo_url?: string | null
  brand_color?: string | null
  licensed?: boolean
  payments?: { instapay?: string | null; vodafone?: string | null; bank?: string | null }
  classes?: PublicClass[]
}

export async function fetchPublicPage(slug: string): Promise<PublicPageData> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('nursery_public_page', { p_slug: slug })
  if (error) throw error
  return (data ?? { found: false }) as PublicPageData
}

export type PublicPageName = 'home' | 'classes' | 'about'

/** تتبع مجهول (3.3): لا يعطّل الصفحة أبداً عند أي فشل. */
export async function trackPublicPage(
  slug: string,
  kind: 'view' | 'whatsapp_click',
  page: PublicPageName,
): Promise<void> {
  try {
    const db = requireSupabase()
    await db.rpc('public_page_track', {
      p_slug: slug,
      p_kind: kind,
      p_page: page,
    })
  } catch {
    // الإحصاء لا يكسر تجربة الزائر إطلاقاً
  }
}

export async function bookTour(
  slug: string,
  input: {
    parentName: string
    phone: string
    childName: string
    preferredAt: string | null
    note: string | null
  },
): Promise<{ ok: boolean }> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('public_book_tour', {
    p_slug: slug,
    p_parent_name: input.parentName,
    p_parent_phone: input.phone,
    p_child_name: input.childName,
    p_preferred_at: input.preferredAt,
    p_note: input.note,
  })
  if (error) return { ok: false }
  return data as { ok: boolean }
}
