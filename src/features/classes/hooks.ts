import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { invalidatePrefixes } from '../../lib/invalidate'
import * as api from './api'

export function useClasses() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['classes', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listClasses(nurseryId!),
  })
}

export function useClassStaff(classId: string | undefined) {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['class-staff', nurseryId, classId],
    enabled: Boolean(nurseryId && classId),
    queryFn: () => api.listClassStaff(nurseryId!, classId!),
  })
}

/** حالة اليوم لكل الفصول (اتفتح/حاضر/غائب) — قراءة فقط لموجة الهوية 2 */
export function useClassesToday(date: string) {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  return useQuery({
    queryKey: ['classes-today', nurseryId, date],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listClassesToday(nurseryId!, date),
  })
}

/** أسماء مشرفات كل فصل — قراءة فقط لموجة الهوية 2 */
export function useClassesStaffNames(classIds: string[]) {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const key = classIds.join(',')
  return useQuery({
    queryKey: ['classes-staff-names', nurseryId, key],
    enabled: Boolean(nurseryId && classIds.length > 0),
    queryFn: () => api.listClassesStaffNames(nurseryId!, classIds),
  })
}

export function useClassMutations() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const qc = useQueryClient()
  const refresh = () => invalidatePrefixes(qc, ['classes', 'class-staff', 'children', 'home'])
  return {
    nurseryId,
    create: useMutation({
      mutationFn: (input: api.ClassInput) => api.createClass(nurseryId!, input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (args: { classId: string; patch: Partial<api.ClassInput> }) =>
        api.updateClass(args.classId, args.patch),
      onSuccess: refresh,
    }),
    archive: useMutation({
      mutationFn: (classId: string) => api.archiveClass(classId),
      onSuccess: refresh,
    }),
    setStaff: useMutation({
      mutationFn: (args: { classId: string; memberId: string; assigned: boolean }) =>
        api.setClassStaff(args.classId, args.memberId, args.assigned),
      onSuccess: refresh,
    }),
  }
}
