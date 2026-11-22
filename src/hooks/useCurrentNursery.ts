import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthProvider'
import { useActiveNurseryId } from '../lib/workspace'
import type {
  MemberPermissions,
  NurseryMemberRow,
  NurseryRow,
  PermissionKey,
} from '../types/database'

export type NurseryResolution =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** مسجل دخول لكن بلا أي عضوية فعّالة — يحتاج إنشاء حضانة أو دعوة */
  | { status: 'no-nursery' }
  | {
      status: 'ready'
      nurseryId: string
      nursery: NurseryRow
      role: 'owner' | 'staff'
      permissions: MemberPermissions
      /** كل عضوياته الفعّالة (للمبدّل) */
      memberships: (NurseryMemberRow & { nursery: NurseryRow })[]
      can: (key: PermissionKey) => boolean
      isOwner: boolean
    }

const MEMBER_COLS =
  'id, nursery_id, user_id, invited_email, role, permissions, status, created_at, updated_at'
const NURSERY_COLS = 'id, name, logo_url, phone, address, created_by, created_at, updated_at'

/**
 * يحلّ «الحضانة النشطة» من جلسة Supabase:
 * 1) ادعاء دعوات البريد المعلّقة (RPC ‏claim_nursery_invites — مرة لكل جلسة).
 * 2) عضويات nursery_members الفعّالة + بيانات حضاناتها.
 * اختيار النشطة: المحفوظة في lib/workspace إن صلحت، وإلا أول مملوكة،
 * وإلا أول عضوية. المالية ليست صلاحية: المالك وحده يراها (RLS)، و`can`
 * هنا لإظهار/إخفاء واجهة فقط — الحسم دائماً في RLS.
 */
const claimAttemptedFor = new Set<string>()

export function useCurrentNursery(): NurseryResolution {
  const { user, loading: authLoading } = useAuth()
  const activeNurseryId = useActiveNurseryId()

  const query = useQuery({
    queryKey: ['current-nursery', user?.id ?? null, activeNurseryId],
    enabled: Boolean(supabase && user),
    queryFn: async (): Promise<
      (NurseryMemberRow & { nursery: NurseryRow })[] | null
    > => {
      const db = supabase!
      const uid = user!.id

      if (!claimAttemptedFor.has(uid)) {
        claimAttemptedFor.add(uid)
        try {
          await db.rpc('claim_nursery_invites')
        } catch {
          // تجاهل متعمّد ومسجّل في التعليق: فشل الادعاء لا يكسر حلّ الهوية
          claimAttemptedFor.delete(uid)
        }
      }

      const { data, error } = await db
        .from('nursery_members')
        .select(`${MEMBER_COLS}, nursery:nurseries(${NURSERY_COLS})`)
        .eq('user_id', uid)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = (data ?? []) as unknown as (NurseryMemberRow & {
        nursery: NurseryRow
      })[]
      return rows.length > 0 ? rows : null
    },
  })

  if (authLoading) return { status: 'loading' }
  if (!user) return { status: 'signed-out' }
  if (query.isPending) return { status: 'loading' }
  if (!query.data) return { status: 'no-nursery' }

  const memberships = query.data
  const active =
    memberships.find((m) => m.nursery_id === activeNurseryId) ??
    memberships.find((m) => m.role === 'owner') ??
    memberships[0]
  const isOwner = active.role === 'owner'
  const permissions = active.permissions ?? {}
  return {
    status: 'ready',
    nurseryId: active.nursery_id,
    nursery: active.nursery,
    role: active.role,
    permissions,
    memberships,
    isOwner,
    can: (key) => isOwner || permissions[key] === true,
  }
}
