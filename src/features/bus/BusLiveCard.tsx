/**
 * بطاقة البث الحي للباص (3A-414): بدء/إنهاء صريح للبث على قائمة اليوم.
 * تظهر فقط لصاحب صلاحية إدارة الباص؛ بلا جلسة نشطة تعرض زر البدء فقط.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigation, Square } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { formatClock12 } from '../../lib/format'
import {
  endLiveSession,
  getActiveLiveSession,
  startLiveSession,
  useLiveBroadcast,
} from './live'

const GEO_ERROR_KEYS = {
  unsupported: 'bus.liveUnsupported',
  denied: 'bus.liveNoPermission',
  unavailable: 'bus.liveUnavailable',
  timeout: 'bus.liveTimeout',
} as const

export function BusLiveCard({
  listId,
  routeName,
}: {
  listId: string
  routeName: string
}) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()

  const session = useQuery({
    queryKey: ['bus-live', listId],
    queryFn: () => getActiveLiveSession(listId),
  })
  const activeId = session.data?.id ?? null
  const { lastSentAt, geoError } = useLiveBroadcast(activeId)

  const start = useMutation({
    mutationFn: () => startLiveSession(listId),
    onSuccess: (s) => {
      qc.setQueryData(['bus-live', listId], s)
      showToast(t('bus.liveStarted'))
    },
    onError: () => showToast(t('bus.liveStartFailed')),
  })
  const stop = useMutation({
    mutationFn: () => endLiveSession(activeId!),
    onSuccess: () => {
      qc.setQueryData(['bus-live', listId], null)
      showToast(t('bus.liveStopped'))
    },
    onError: () => showToast(t('bus.liveStopFailed')),
  })

  const lastSent = lastSentAt ?? session.data?.last_loc_at ?? null

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Navigation size={18} className="text-primary shrink-0" />
          <span className="type-section">{t('bus.liveTitle')}</span>
          {activeId && (
            <span className="type-badge text-ok bg-ok-soft rounded-full px-2 py-0.5 flex items-center gap-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-ok" />
              </span>
              {t('bus.liveActive')}
            </span>
          )}
        </div>
      </div>
      <p className="type-secondary text-muted mt-1">
        {t('bus.liveHint', { route: routeName })}
      </p>
      {geoError && (
        <p className="type-badge text-bad-text mt-2">
          {t(GEO_ERROR_KEYS[geoError])}
        </p>
      )}
      {activeId && lastSent && (
        <p className="type-badge text-muted mt-2">
          {t('bus.liveLastSent', { time: formatClock12(lastSent) })}
        </p>
      )}
      <div className="flex gap-2 mt-3">
        {activeId ? (
          <Button
            variant="danger"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
          >
            <Square size={16} />
            {t('bus.liveStop')}
          </Button>
        ) : (
          <Button
            onClick={() => start.mutate()}
            disabled={start.isPending || session.isPending}
          >
            <Navigation size={16} />
            {t('bus.liveStart')}
          </Button>
        )}
      </div>
    </Card>
  )
}
