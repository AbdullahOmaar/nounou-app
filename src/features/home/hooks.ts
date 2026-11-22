import { useQuery } from '@tanstack/react-query'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import * as api from './api'

export function useHomeSummary() {
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  return useQuery({
    queryKey: ['home', nurseryId, isOwner],
    enabled: Boolean(nurseryId),
    queryFn: () => api.fetchHomeSummary(nurseryId!, isOwner),
  })
}
