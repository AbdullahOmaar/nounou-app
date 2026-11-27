import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as api from './api'

export function useNurserySettings() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['nursery-settings', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.getNurserySettings(nurseryId!),
  })
}

export function useMembers() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['members', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listMembers(nurseryId!),
  })
}

export function useSettingsMutations() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const qc = useQueryClient()
  const refresh = () =>
    invalidatePrefixes(qc, ['nursery-settings', 'members', 'current-nursery', 'home'])
  return {
    nurseryId,
    updateSettings: useMutation({
      mutationFn: (patch: Parameters<typeof api.updateNurserySettings>[1]) =>
        api.updateNurserySettings(nurseryId!, patch),
      onSuccess: refresh,
    }),
    updateProfile: useMutation({
      mutationFn: (patch: Parameters<typeof api.updateNurseryProfile>[1]) =>
        api.updateNurseryProfile(nurseryId!, patch),
      onSuccess: refresh,
    }),
    invite: useMutation({
      // الدعوة تُحفظ أولاً ثم يُرسل إيميلها (0.7) — حالة الإيميل ترجع للواجهة
      mutationFn: async (args: {
        email: string
        permissions: Parameters<typeof api.inviteMember>[2]
      }) => {
        await api.inviteMember(nurseryId!, args.email, args.permissions)
        return api.sendInviteEmail(nurseryId!, args.email)
      },
      onSuccess: refresh,
    }),
    updateMember: useMutation({
      mutationFn: (args: { memberId: string; patch: Parameters<typeof api.updateMember>[1] }) =>
        api.updateMember(args.memberId, args.patch),
      onSuccess: refresh,
    }),
    removeMember: useMutation({
      mutationFn: (memberId: string) => api.removeMember(nurseryId!, memberId),
      onSuccess: refresh,
    }),
  }
}
