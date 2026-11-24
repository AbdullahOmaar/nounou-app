import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarPlus, MapPin, PartyPopper } from 'lucide-react'
import * as api from './api'
import type { PublicEvent } from './api'
import { bannerUrl, eventBannerKey } from '../public/banners'
import { AiDisclosure } from '../../components/ui/AiDisclosure'
import { useT } from '../../i18n'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { formatDateTimeAr, waLink } from '../../lib/format'

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function downloadIcs(ev: PublicEvent) {
  const start = new Date(ev.starts_at!)
  const end = ev.ends_at
    ? new Date(ev.ends_at)
    : new Date(start.getTime() + 2 * 3600_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nounou//Events//AR',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@nounou`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${ev.title ?? ''} — ${ev.nursery?.name ?? ''}`,
    `LOCATION:${ev.location_text ?? ''}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const blob = new Blob([lines.join('\r\n')], {
    type: 'text/calendar;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'event.ics'
  a.click()
  URL.revokeObjectURL(url)
}

/** صفحة الدعوة العامة /e/:code — خريطة + تقويم + RSVP واتساب. */
export default function EventInvitePage() {
  const t = useT()
  const { code } = useParams<{ code: string }>()
  const [ev, setEv] = useState<PublicEvent | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .fetchPublicEvent(code!)
      .then((d) => alive && setEv(d))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [code])

  if (failed) {
    return (
      <div className="min-h-dvh bg-bg text-text p-4">
        <ErrorState message={t('pub.notFound')} />
      </div>
    )
  }
  if (!ev) {
    return (
      <div className="min-h-dvh bg-bg text-text p-4">
        <LoadingState />
      </div>
    )
  }
  if (!ev.found) {
    return (
      <div className="min-h-dvh bg-bg text-text p-4">
        <ErrorState message={t('pub.notFound')} />
      </div>
    )
  }

  const brand = ev.nursery?.brand_color ?? undefined
  const maps =
    ev.maps_url ??
    (ev.location_text
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location_text)}`
      : null)
  const wa = waLink(ev.nursery?.phone ?? null)
  const rsvp = wa
    ? `${wa}?text=${encodeURIComponent(`${t('events.rsvpText')} ${ev.title ?? ''}`)}`
    : null

  return (
    <div className="min-h-dvh bg-bg text-text">
      {brand && <div style={{ backgroundColor: brand }} className="h-1.5" />}
      <div className="mx-auto max-w-[640px] px-4 py-8 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {ev.nursery?.logo_url && (
            <img
              src={ev.nursery.logo_url}
              alt=""
              className="w-12 h-12 rounded-2xl object-cover"
            />
          )}
          <div className="type-secondary text-muted">{ev.nursery?.name}</div>
        </div>
        <div className="relative overflow-hidden rounded-3xl">
          <img
            src={bannerUrl(eventBannerKey(ev.kind ?? 'other', ev.nursery?.banner_key))}
            alt=""
            className="w-full aspect-[16/9] object-cover"
          />
          <span className="absolute bottom-2 end-2">
            <AiDisclosure />
          </span>
        </div>
        <Card>
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <PartyPopper size={36} />
            <h1 className="type-title">{ev.title}</h1>
            <div className="type-body">
              {formatDateTimeAr(ev.starts_at!)}
            </div>
            {ev.location_text && (
              <div className="type-secondary text-muted inline-flex items-center gap-1">
                <MapPin size={16} />
                {ev.location_text}
              </div>
            )}
          </div>
          {(ev.halls ?? []).length > 0 && (
            <div className="flex flex-col gap-3">
              {(ev.halls ?? []).map((h, i) => {
                const hMaps =
                  h.maps_url ??
                  (h.location_text
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.location_text)}`
                    : null)
                const hRsvp = wa
                  ? `${wa}?text=${encodeURIComponent(`${t('events.rsvpText')} ${ev.title ?? ''} — ${h.name}`)}`
                  : null
                return (
                  <div key={i} className="rounded-2xl bg-soft p-3">
                    <div className="type-body mb-1">{h.name}</div>
                    {h.location_text && (
                      <div className="type-secondary text-muted mb-2">{h.location_text}</div>
                    )}
                    <div className="flex gap-2">
                      {hMaps && (
                        <a href={hMaps} target="_blank" rel="noreferrer">
                          <Button>
                            <MapPin size={16} />
                            {t('events.openMap')}
                          </Button>
                        </a>
                      )}
                      {hRsvp && (
                        <a href={hRsvp} target="_blank" rel="noreferrer">
                          <Button>{t('events.rsvp')}</Button>
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {(ev.halls ?? []).length === 0 && maps && (
              <a href={maps} target="_blank" rel="noreferrer">
                <Button full style={brand ? { backgroundColor: brand } : undefined}>
                  <MapPin size={16} />
                  {t('events.openMap')}
                </Button>
              </a>
            )}
            <Button full onClick={() => downloadIcs(ev)}>
              <CalendarPlus size={16} />
              {t('events.addCalendar')}
            </Button>
            {(ev.halls ?? []).length === 0 && rsvp && (
              <a href={rsvp} target="_blank" rel="noreferrer">
                <Button full>{t('events.rsvp')}</Button>
              </a>
            )}
          </div>
        </Card>
        <div className="type-badge text-muted text-center">{t('pub.poweredBy')}</div>
      </div>
    </div>
  )
}
