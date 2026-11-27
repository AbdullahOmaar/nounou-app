/**
 * قسم الباص الحي في بوابة ولي الأمر (3A-414).
 * يُستطلع كل 15 ثانية؛ بلا تشغيل نشط لطفل الوصي لا يظهر القسم أصلاً.
 * إشارة أقدم من 60 ثانية لا تُعرض كحية أبداً — تظهر «آخر تحديث» فقط.
 */
import { useQuery } from '@tanstack/react-query'
import { Bus as BusIcon } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useT } from '../../i18n'
import { formatClock12 } from '../../lib/format'
import * as api from './api'
import { isBusLiveStale, osmTileGrid } from './busLive'

export function BusLiveSection({ token }: { token: string }) {
  const t = useT()
  const live = useQuery({
    queryKey: ['portal-bus-live', token],
    queryFn: () => api.fetchPortalBusLive(token),
    refetchInterval: 15_000,
    retry: false,
  })

  if (live.isPending) return null

  // فشل الاستطلاع: حالة متهندلة ظاهرة، لا اختفاء صامت للقسم.
  if (live.isError) {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <BusIcon size={18} className="text-primary shrink-0" />
          <span className="type-section">{t('portal.busLiveTitle')}</span>
        </div>
        <p className="type-secondary text-muted mt-1">
          {t('portal.busLiveUnavailable')}
        </p>
      </Card>
    )
  }

  // بلا تشغيل نشط لطفل الوصي: لا قسم — ليست حالة خطأ ولا حالة فارغة.
  if (!live.data?.found) return null
  const data = live.data

  const stale = isBusLiveStale(data.loc_at)
  const hasPosition = data.lat != null && data.lng != null
  const grid = hasPosition ? osmTileGrid(data.lat!, data.lng!) : null

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BusIcon size={18} className="text-primary shrink-0" />
          <span className="type-section">{t('portal.busLiveTitle')}</span>
        </div>
        {hasPosition && !stale && (
          <span className="type-badge text-ok bg-ok-soft rounded-full px-2 py-0.5 flex items-center gap-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-ok" />
            </span>
            {t('portal.busLiveNow')}
          </span>
        )}
        {hasPosition && stale && (
          <span className="type-badge text-warn-text bg-warn-soft rounded-full px-2 py-0.5">
            {t('portal.busLiveStale')}
          </span>
        )}
      </div>
      <p className="type-secondary text-muted mt-1">
        {t('portal.busLiveRoute', {
          route: data.route_name ?? '',
          direction:
            data.direction === 'to_nursery'
              ? t('bus.morningList')
              : t('bus.eveningList'),
        })}
      </p>

      {!hasPosition ? (
        <p className="type-body mt-2">{t('portal.busLiveWaiting')}</p>
      ) : (
        <>
          <div className="relative h-[220px] rounded-2xl overflow-hidden mt-3 bg-soft">
            {grid!.tiles.map((t) => (
              <img
                key={`${t.dx}/${t.dy}`}
                src={t.url}
                alt=""
                className="absolute w-[256px] h-[256px] max-w-none"
                style={{
                  left: `calc(50% - ${grid!.center.px}px + ${t.dx * 256}px)`,
                  top: `calc(50% - ${grid!.center.py}px + ${t.dy * 256}px)`,
                }}
              />
            ))}
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${
                  stale ? '' : 'animate-ping bg-primary'
                }`}
              />
              <span
                className={`relative inline-flex h-5 w-5 rounded-full border-2 border-white shadow ${
                  stale ? 'bg-warn' : 'bg-primary'
                }`}
              />
            </span>
          </div>
          <p className="type-badge text-muted mt-2">
            {stale
              ? t('portal.busLiveLastUpdate', {
                  time: formatClock12(data.loc_at!),
                })
              : t('portal.busLiveUpdated', {
                  time: formatClock12(data.loc_at!),
                })}
          </p>
          <p className="type-badge text-muted">
            © OpenStreetMap contributors
          </p>
        </>
      )}
    </Card>
  )
}
