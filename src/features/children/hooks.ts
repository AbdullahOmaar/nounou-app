import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as api from './api'

export function useChildren() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['children', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listChildren(nurseryId!),
  })
}

export function useChild(childId: string | undefined) {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['child', nurseryId, childId],
    enabled: Boolean(nurseryId && childId),
    queryFn: () => api.getChildBundle(nurseryId!, childId!),
  })
}

export function useChildMutations() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const qc = useQueryClient()
  const refresh = () =>
    invalidatePrefixes(qc, ['children', 'child', 'home', 'classes'])

  return {
    nurseryId,
    create: useMutation({
      mutationFn: (input: api.ChildInput) => api.createChild(nurseryId!, input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (args: { childId: string; patch: Parameters<typeof api.updateChild>[2] }) =>
        api.updateChild(nurseryId!, args.childId, args.patch),
      onSuccess: refresh,
    }),
    archive: useMutation({
      mutationFn: (childId: string) => api.archiveChild(nurseryId!, childId),
      onSuccess: refresh,
    }),
    moveClass: useMutation({
      mutationFn: (args: { childId: string; classId: string | null }) =>
        api.moveChildClass(nurseryId!, args.childId, args.classId),
      onSuccess: refresh,
    }),
    addGuardian: useMutation({
      mutationFn: (args: { childId: string; input: Parameters<typeof api.addGuardian>[2] }) =>
        api.addGuardian(nurseryId!, args.childId, args.input),
      onSuccess: refresh,
    }),
    removeGuardian: useMutation({
      mutationFn: (args: { guardianId: string; childId: string }) =>
        api.removeGuardianLink(args.guardianId, args.childId),
      onSuccess: refresh,
    }),
    savePickup: useMutation({
      mutationFn: (args: { childId: string; input: Parameters<typeof api.savePickupPerson>[2] }) =>
        api.savePickupPerson(nurseryId!, args.childId, args.input),
      onSuccess: refresh,
    }),
    deletePickup: useMutation({
      mutationFn: (id: string) => api.deletePickupPerson(id),
      onSuccess: refresh,
    }),
    saveHealth: useMutation({
      mutationFn: (args: { childId: string; profile: Parameters<typeof api.saveHealthProfile>[2] }) =>
        api.saveHealthProfile(nurseryId!, args.childId, args.profile),
      onSuccess: refresh,
    }),
    saveMedication: useMutation({
      mutationFn: (args: { childId: string; input: Parameters<typeof api.saveMedication>[2] }) =>
        api.saveMedication(nurseryId!, args.childId, args.input),
      onSuccess: refresh,
    }),
    deleteMedication: useMutation({
      mutationFn: (id: string) => api.deleteMedication(id),
      onSuccess: refresh,
    }),
  }
}
