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
  licensed?: boolean
  classes?: PublicClass[]
}

export async function fetchPublicPage(slug: string): Promise<PublicPageData> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('nursery_public_page', { p_slug: slug })
  if (error) throw error
  return (data ?? { found: false }) as PublicPageData
}
