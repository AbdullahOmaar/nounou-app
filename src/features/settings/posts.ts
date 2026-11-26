import { requireSupabase } from '../../lib/supabase'

/**
 * منشورات الصفحة العامة (3A-891): تجهيز المحتوى الدوري داخل
 * التطبيق — مسودة/منشور على صفحة الحضانة العامة نفسها. النشر
 * على الحساب الاجتماعي الخارجي خطوة منفصلة واقفة على المالك.
 */
export interface NurseryPost {
  id: string
  title: string
  body: string
  image_key: string | null
  status: 'draft' | 'published'
  published_at: string | null
  created_at: string
}

export interface PostDraft {
  title: string
  body: string
  image_key: string | null
  status: 'draft' | 'published'
}

export async function listNurseryPosts(
  nurseryId: string,
): Promise<NurseryPost[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('public_posts')
    .select('id, title, body, image_key, status, published_at, created_at')
    .eq('nursery_id', nurseryId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as NurseryPost[]
}

export async function createPost(
  nurseryId: string,
  draft: PostDraft,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('public_posts').insert({
    nursery_id: nurseryId,
    title: draft.title,
    body: draft.body,
    image_key: draft.image_key,
    status: draft.status,
    published_at: draft.status === 'published' ? new Date().toISOString() : null,
  })
  if (error) throw error
}

export async function updatePost(
  postId: string,
  draft: PostDraft,
  previousStatus: 'draft' | 'published',
): Promise<void> {
  const db = requireSupabase()
  const patch: Record<string, unknown> = {
    title: draft.title,
    body: draft.body,
    image_key: draft.image_key,
    status: draft.status,
    updated_at: new Date().toISOString(),
  }
  if (draft.status === 'published' && previousStatus !== 'published')
    patch.published_at = new Date().toISOString()
  if (draft.status === 'draft') patch.published_at = null
  const { error } = await db.from('public_posts').update(patch).eq('id', postId)
  if (error) throw error
}

export async function deletePost(postId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('public_posts').delete().eq('id', postId)
  if (error) throw error
}
