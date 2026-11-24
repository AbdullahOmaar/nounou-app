import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, PartyPopper, Plus, Trash2 } from 'lucide-react'
import * as api from './api'
import type { EventKind } from './api'
import { useT } from '../../i18n'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Select, TextInput } from '../../components/ui/form'
import { Sheet } from '../../components/ui/Sheet'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useToast } from '../../components/ui/toast'
import { formatDateTimeAr } from '../../lib/format'

const KINDS: EventKind[] = ['graduation', 'open_day', 'aqeeqa', 'other']

export default function EventsPage() {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : ''
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<EventKind>('open_day')
  const [starts, setStarts] = useState('')
  const [location, setLocation] = useState('')
  const [mapsUrl, setMapsUrl] = useState('')

  const events = useQuery({
    queryKey: ['events', nurseryId],
    queryFn: () => api.listEvents(nurseryId),
    enabled: !!nurseryId,
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['events', nurseryId] })
  const create = useMutation({
    mutationFn: () =>
      api.createEvent(nurseryId, {
        title,
        kind,
        startsAt: new Date(starts).toISOString(),
        endsAt: null,
        locationText: location.trim() || null,
        mapsUrl: mapsUrl.trim() || null,
      }),
    onSuccess: () => {
      showToast(t('common.savedOk'))
      setOpen(false)
      setTitle('')
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onSuccess: refresh,
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  if (nursery.status === 'loading' || events.isPending) return <LoadingState />
  if (events.isError) {
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void events.refetch()}
      />
    )
  }
  const rows = events.data ?? []
  const kindLabel = (k: EventKind): string => {
    switch (k) {
      case 'graduation':
        return t('events.kinds.graduation')
      case 'open_day':
        return t('events.kinds.open_day')
      case 'aqeeqa':
        return t('events.kinds.aqeeqa')
      case 'other':
        return t('events.kinds.misc')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="type-title">{t('events.title')}</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} />
          {t('events.new')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title={t('events.empty')}
          hint={t('events.emptyHint')}
        />
      ) : (
        rows.map((ev) => {
          const link = `${window.location.origin}/e/${ev.public_code}`
          return (
            <Card key={ev.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="type-body">{ev.title}</div>
                  <div className="type-secondary text-muted">
                    {kindLabel(ev.kind)} — {formatDateTimeAr(ev.starts_at)}
                  </div>
                  {ev.location_text && (
                    <div className="type-badge text-muted">{ev.location_text}</div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => remove.mutate(ev.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <Button
                className="mt-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(link)
                  showToast(t('events.linkCopied'))
                }}
              >
                <Link2 size={16} />
                {t('events.copyLink')}
              </Button>
            </Card>
          )
        })
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('events.new')}
        footer={
          <Button
            full
            disabled={!title.trim() || !starts || create.isPending}
            onClick={() => create.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        <Field label={t('events.eventTitle')}>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('events.eventKind')}>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as EventKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('events.startsAt')}>
          <TextInput
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </Field>
        <Field label={t('events.location')}>
          <TextInput value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label={t('events.mapsUrl')}>
          <TextInput
            dir="ltr"
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
          />
        </Field>
      </Sheet>
    </div>
  )
}
