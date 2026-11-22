import { useQuery } from '@tanstack/react-query'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import * as api from './api'

export function useAlerts() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  return useQuery({
    queryKey: ['alerts', nurseryId, isOwner],
    enabled: Boolean(nurseryId),
    queryFn: () => api.fetchAlerts(nurseryId!, isOwner),
    refetchInterval: 60_000,
  })
}

/** شارة الجرس: عدد أنواع التنبيهات النشطة المتميزة (قاعدة المدرس: بحد أقصى ٦) */
export function useAlertSummary(nurseryId: string | null, isOwner: boolean) {
  return useQuery({
    queryKey: ['alerts', nurseryId, isOwner],
    enabled: Boolean(nurseryId),
    queryFn: () => api.fetchAlerts(nurseryId!, isOwner),
    refetchInterval: 60_000,
    select: (alerts) => Math.min(alerts.length, 6),
  })
}
