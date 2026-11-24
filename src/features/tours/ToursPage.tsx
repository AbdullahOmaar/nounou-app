import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Phone } from 'lucide-react'
import * as api from './api'
import type { TourRequest } from './api'
import { useT } from '../../i18n'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { listClasses } from '../classes/api'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Select } from '../../components/ui/form'
import { Sheet } from '../../components/ui/Sheet'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useToast } from '../../components/ui/toast'
import { formatDateTimeAr, waLink } from '../../lib/format'

function useStatusLabel() {
  const t = useT()
  return (status: TourRequest['status']): string => {
    switch (status) {
      case 'new':
        return t('tours.status.new')
      case 'contacted':
        return t('tours.status.contacted')
      case 'done':
        return t('tours.status.done')
      case 'converted':
        return t('tours.status.converted')
    }
  }
}

export default function ToursPage() {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : ''
  const statusLabel = useStatusLabel()
  const [converting, setConverting] = useState<TourRequest | null>(null)
  const [classId, setClassId] = useState('')

  const requests = useQuery({
    queryKey: ['tour-requests', nurseryId],
    queryFn: () => api.listTourRequests(nurseryId),
    enabled: !!nurseryId,
  })
  const classes = useQuery({
    queryKey: ['classes', nurseryId],
    queryFn: () => listClasses(nurseryId),
    enabled: !!nurseryId,
  })

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ['tour-requests', nurseryId] })
  const status = useMutation({
    mutationFn: (args: { id: string; status: TourRequest['status'] }) =>
      api.setTourStatus(nurseryId, args.id, args.status),
    onSuccess: refresh,
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const convert = useMutation({
    mutationFn: (req: TourRequest) =>
      api.convertTourRequest(nurseryId, req, classId || null),
    onSuccess: () => {
      showToast(t('tours.convertedOk'))
      setConverting(null)
      refresh()
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })

  if (nursery.status === 'loading' || requests.isPending) return <LoadingState />
  if (requests.isError) {
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void requests.refetch()}
      />
    )
  }
  const rows = requests.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <h1 className="type-title">{t('tours.title')}</h1>
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={t('tours.empty')}
          hint={t('tours.emptyHint')}
        />
      ) : (
        rows.map((r) => {
          const wa = waLink(r.parent_phone)
          return (
            <Card key={r.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="type-body">{r.child_name}</div>
                  <div className="type-secondary text-muted">
                    {r.parent_name} — <span dir="ltr">{r.parent_phone}</span>
                  </div>
                  {r.preferred_at && (
                    <div className="type-badge text-muted">
                      {t('tours.preferred')}: {formatDateTimeAr(r.preferred_at)}
                    </div>
                  )}
                  {r.note && (
                    <div className="type-badge text-muted">{r.note}</div>
                  )}
                </div>
                <span className="type-badge bg-soft rounded-full px-2 py-0.5">
                  {statusLabel(r.status)}
                </span>
              </div>
              {r.status !== 'converted' && (
                <div className="flex gap-2 mt-2">
                  {wa && (
                    <a href={wa} target="_blank" rel="noreferrer">
                      <Button>
                        <Phone size={16} />
                        {t('tours.call')}
                      </Button>
                    </a>
                  )}
                  {r.status === 'new' && (
                    <Button
                      onClick={() =>
                        status.mutate({ id: r.id, status: 'contacted' })
                      }
                    >
                      {t('tours.markContacted')}
                    </Button>
                  )}
                  {r.status !== 'done' && (
                    <Button
                      onClick={() => status.mutate({ id: r.id, status: 'done' })}
                    >
                      {t('tours.markDone')}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      setConverting(r)
                      setClassId('')
                    }}
                  >
                    {t('tours.convert')}
                  </Button>
                </div>
              )}
            </Card>
          )
        })
      )}

      <Sheet
        open={!!converting}
        onClose={() => setConverting(null)}
        title={t('tours.convert')}
        footer={
          <Button
            full
            disabled={convert.isPending}
            onClick={() => converting && convert.mutate(converting)}
          >
            {t('tours.convertConfirm')}
          </Button>
        }
      >
        <p className="type-secondary text-muted mb-3">{t('tours.convertHint')}</p>
        <Field label={t('tours.classLabel')}>
          <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">{t('tours.noClass')}</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </Sheet>
    </div>
  )
}
