import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bus as BusIcon, Check, Plus, X } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, Select, TextInput } from '../../components/ui/form'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { formatClock12, formatMoney, todayISO } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useAuth } from '../../lib/AuthProvider'
import { invalidatePrefixes } from '../../lib/invalidate'
import { useMembers } from '../settings/hooks'
import type { BusDirection } from '../../types/database'
import * as api from './api'
import { BusLiveCard } from './BusLiveCard'

/**
 * الباص البسيط: خطوط + اشتراكات شهرية (تغذي سطر الباص في الفواتير) +
 * قوائم يومية ركوب/نزول بتعليم لمسي واحد + بث حي لموقع الباص (3A-414).
 */
export function BusPage() {
  const t = useT()
  const showToast = useToast()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const canBus = nursery.status === 'ready' && nursery.can('can_manage_bus')
  const { user } = useAuth()
  const qc = useQueryClient()
  const members = useMembers()
  const [routeId, setRouteId] = useState('')
  const [tab, setTab] = useState<'lists' | 'subs'>('lists')
  const [direction, setDirection] = useState<BusDirection>('to_nursery')
  const [closeOpen, setCloseOpen] = useState(false)
  const [routeSheet, setRouteSheet] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [routeSupervisor, setRouteSupervisor] = useState('')
  // X1 (3A-378): ورقة تسليم النزول — المستلم اختيار إجباري صريح
  const [handoverEntry, setHandoverEntry] = useState<{
    id: string
    pickupPersons: { id: string; full_name: string }[]
  } | null>(null)
  const [handoverChoice, setHandoverChoice] = useState('')
  const [subSheet, setSubSheet] = useState(false)
  const [subChild, setSubChild] = useState('')
  const [subFee, setSubFee] = useState('')
  const date = todayISO()

  const routes = useQuery({
    queryKey: ['bus-routes', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: () => api.listRoutes(nurseryId!),
  })
  const activeRouteId = routeId || routes.data?.[0]?.id || ''
  const subs = useQuery({
    queryKey: ['bus-subs', activeRouteId],
    enabled: Boolean(activeRouteId),
    queryFn: () => api.listSubscriptions(activeRouteId),
  })
  const dayList = useQuery({
    queryKey: ['bus-list', nurseryId, activeRouteId, date, direction],
    enabled: Boolean(nurseryId && activeRouteId && tab === 'lists'),
    queryFn: () => api.getOrBuildDayList(nurseryId!, activeRouteId, date, direction),
  })
  const allChildren = useQuery({
    queryKey: ['children', nurseryId],
    enabled: Boolean(nurseryId && subSheet),
    queryFn: () => api.listAllChildren(nurseryId!),
  })

  const refresh = () =>
    invalidatePrefixes(qc, ['bus-routes', 'bus-subs', 'bus-list', 'invoices'])
  const saveRoute = useMutation({
    mutationFn: () =>
      api.saveRoute(nurseryId!, {
        name: routeName,
        supervisor_member_id: routeSupervisor || null,
      }),
    onSuccess: () => {
      refresh()
      setRouteSheet(false)
      setRouteName('')
    },
  })
  const saveSub = useMutation({
    mutationFn: () =>
      api.saveSubscription(nurseryId!, {
        child_id: subChild,
        route_id: activeRouteId,
        monthly_fee: parseFloat(subFee) || 0,
      }),
    onSuccess: () => {
      refresh()
      setSubSheet(false)
    },
  })
  const deleteSub = useMutation({
    mutationFn: (id: string) => api.deleteSubscription(id),
    onSuccess: refresh,
  })
  const setStatus = useMutation({
    mutationFn: (args: {
      entryId: string
      status: 'done' | 'absent' | 'pending'
      handedTo?: string | null
      doorstep?: boolean
    }) =>
      api.setEntryStatus(
        args.entryId,
        args.status,
        user?.id ?? null,
        args.handedTo ?? null,
        args.doorstep ?? false,
      ),
    onSuccess: refresh,
  })
  const closeTrip = useMutation({
    mutationFn: (args: { listId: string; summary: string }) =>
      api.closeBusTrip(nurseryId!, args.listId, args.summary),
    onSuccess: () => {
      setCloseOpen(false)
      showToast(t('bus.tripClosed'))
    },
  })

  if (routes.isPending) return <LoadingState />
  if (routes.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void routes.refetch()}
      />
    )

  const entries = dayList.data?.entries ?? []
  const doneCount = entries.filter((e) => e.status !== 'pending').length
  const activeRoute = (routes.data ?? []).find((r) => r.id === activeRouteId)
  const supervisorName = activeRoute?.supervisor_member_id
    ? (members.data ?? []).find((m) => m.id === activeRoute.supervisor_member_id)
        ?.display_name
    : undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ChipRow>
          {(routes.data ?? []).map((r) => (
            <Chip
              key={r.id}
              active={activeRouteId === r.id}
              onClick={() => setRouteId(r.id)}
            >
              {r.name}
            </Chip>
          ))}
        </ChipRow>
        {canBus && (
          <Button size="sm" variant="soft" onClick={() => setRouteSheet(true)}>
            <Plus size={16} />
            {t('bus.addRoute')}
          </Button>
        )}
      </div>

      {(routes.data ?? []).length === 0 ? (
        <EmptyState
          title={t('bus.emptyRoutes')}
          hint={t('bus.emptyRoutesBody')}
          icon={BusIcon}
        />
      ) : (
        <>
          <ChipRow>
            <Chip active={tab === 'lists'} onClick={() => setTab('lists')}>
              {t('bus.todayLists')}
            </Chip>
            <Chip active={tab === 'subs'} onClick={() => setTab('subs')}>
              {t('bus.subscribers')}
            </Chip>
          </ChipRow>

          {tab === 'lists' && (
            <>
              <ChipRow>
                <Chip
                  active={direction === 'to_nursery'}
                  onClick={() => setDirection('to_nursery')}
                >
                  {t('bus.morningList')}
                </Chip>
                <Chip
                  active={direction === 'to_home'}
                  onClick={() => setDirection('to_home')}
                >
                  {t('bus.eveningList')}
                </Chip>
              </ChipRow>
              {dayList.isPending ? (
                <LoadingState />
              ) : entries.length === 0 ? (
                <EmptyState title={t('bus.emptyList')} />
              ) : (
                <>
                  {/* هوية نونو — الموجة 3: بطاقة حالة كحلية + أطفال الخط كمجموعة */}
                  <div className="bg-primary text-on-primary rounded-2xl p-4 shadow-card">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="type-title">{activeRoute?.name ?? ''}</h2>
                      <span className="type-badge bg-on-primary/15 rounded-full px-2.5 py-1">
                        {doneCount === entries.length
                          ? t('bus.heroDone')
                          : doneCount > 0
                            ? t('bus.heroInProgress')
                            : t('bus.heroNotStarted')}
                      </span>
                    </div>
                    <p className="type-secondary text-on-primary-muted mt-1">
                      {direction === 'to_nursery'
                        ? t('bus.morningList')
                        : t('bus.eveningList')}
                      {supervisorName
                        ? ` • ${t('bus.supervisor')}: ${supervisorName}`
                        : ''}
                    </p>
                    <div className="h-2 rounded-full bg-on-primary/15 mt-3 overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full"
                        style={{
                          width: `${entries.length ? Math.round((doneCount / entries.length) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <p className="type-badge text-on-primary-muted mt-2">
                      {t('bus.listProgress', { done: doneCount, total: entries.length })}
                    </p>
                  </div>
                  {canBus && dayList.data && (
                    <BusLiveCard
                      listId={dayList.data.list.id}
                      routeName={activeRoute?.name ?? ''}
                    />
                  )}
                  <Card className="p-0 overflow-hidden">
                    <div className="type-section px-4 pt-3 pb-1">
                      {t('bus.routeChildren')} ({entries.length})
                    </div>
                    <div className="divide-y divide-border">
                      {entries.map((e) => (
                        <div key={e.id} className="flex items-center justify-between px-4 py-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={e.childName} />
                        <span className="flex flex-col">
                          <span className="type-body">{e.childName}</span>
                          {e.status === 'pending' && (
                            <span className="type-badge text-accent-text">
                              {t('bus.waiting')}
                            </span>
                          )}
                          {e.status === 'done' && direction === 'to_nursery' && e.done_at && (
                            <span className="type-badge text-muted">
                              {t('bus.boardedAt', { time: formatClock12(e.done_at) })}
                            </span>
                          )}
                          {e.status === 'done' && direction === 'to_home' && (
                            <span className="type-badge text-muted">
                              {e.handed_to_doorstep
                                ? t('bus.handedHome')
                                : e.handedToName
                                  ? `${t('bus.handedTo')} ${e.handedToName}`
                                  : ''}
                            </span>
                          )}
                        </span>
                      </span>
                      {canBus &&
                        (e.status === 'pending' ? (
                          <span className="flex gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => {
                                if (direction === 'to_home') {
                                  setHandoverEntry({
                                    id: e.id,
                                    pickupPersons: e.pickupPersons,
                                  })
                                  setHandoverChoice('')
                                } else {
                                  setStatus.mutate({ entryId: e.id, status: 'done' })
                                }
                              }}
                            >
                              <Check size={16} />
                              {direction === 'to_nursery'
                                ? t('bus.markBoarded')
                                : t('bus.markDelivered')}
                            </Button>
                            <Button
                              size="sm"
                              variant="soft"
                              onClick={() =>
                                setStatus.mutate({ entryId: e.id, status: 'absent' })
                              }
                              aria-label={t('bus.markAbsent')}
                            >
                              <X size={16} />
                            </Button>
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setStatus.mutate({ entryId: e.id, status: 'pending' })
                            }
                          >
                            {e.status === 'done'
                              ? direction === 'to_nursery'
                                ? t('bus.markBoarded')
                                : t('bus.markDelivered')
                              : t('bus.markAbsent')}
                            {' ✓'}
                          </Button>
                        ))}
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              )}
              {canBus && entries.length > 0 && (
                <Button full onClick={() => setCloseOpen(true)}>
                  {t('bus.closeTrip')}
                </Button>
              )}
            </>
          )}

          {tab === 'subs' && (
            <>
              {canBus && (
                <Button variant="soft" onClick={() => setSubSheet(true)}>
                  <Plus size={16} />
                  {t('bus.addSubscriber')}
                </Button>
              )}
              <div className="flex flex-col gap-2">
                {(subs.data ?? []).map((s) => (
                  <Card key={s.id} className="flex items-center justify-between py-3">
                    <span className="flex items-center gap-2">
                      <Avatar name={s.childName} />
                      <span className="type-body">{s.childName}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="type-badge text-muted">
                        {formatMoney(s.monthly_fee)} / {t('bus.monthlyFee')}
                      </span>
                      {canBus && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteSub.mutate(s.id)}
                        >
                          <X size={16} />
                        </Button>
                      )}
                    </span>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Sheet
        open={routeSheet}
        onClose={() => setRouteSheet(false)}
        title={t('bus.addRoute')}
        footer={
          <Button
            full
            disabled={!routeName.trim() || saveRoute.isPending}
            onClick={() => saveRoute.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('bus.routeName')}>
            <TextInput
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder={t('bus.routeNamePlaceholder')}
            />
          </Field>
          <Field label={t('bus.supervisor')}>
            <Select
              value={routeSupervisor}
              onChange={(e) => setRouteSupervisor(e.target.value)}
            >
              <option value="">{t('bus.noSupervisor')}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={subSheet}
        onClose={() => setSubSheet(false)}
        title={t('bus.addSubscriber')}
        footer={
          <Button
            full
            disabled={!subChild || saveSub.isPending}
            onClick={() => saveSub.mutate()}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('children.title')}>
            <Select value={subChild} onChange={(e) => setSubChild(e.target.value)}>
              <option value="">—</option>
              {(allChildren.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('bus.monthlyFee')}>
            <TextInput
              type="number"
              inputMode="decimal"
              value={subFee}
              onChange={(e) => setSubFee(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>

      {/* 420-S2: إغلاق الرحلة بتسوية «لا طفل منسيّ» */}
      <Sheet
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={
          entries.some((e) => e.status === 'pending')
            ? t('bus.closePendingTitle')
            : t('bus.closeTrip')
        }
        footer={
          entries.some((e) => e.status === 'pending') ? undefined : (
            <Button
              full
              disabled={closeTrip.isPending || !dayList.data}
              onClick={() =>
                closeTrip.mutate({
                  listId: dayList.data!.list.id,
                  summary: t('bus.closeSummary', {
                    done: entries.filter((e) => e.status === 'done').length,
                    absent: entries.filter((e) => e.status === 'absent').length,
                    total: entries.length,
                  }),
                })
              }
            >
              {t('bus.closeTripConfirm')}
            </Button>
          )
        }
      >
        {entries.some((e) => e.status === 'pending') ? (
          <div className="flex flex-col gap-2">
            <p className="type-secondary text-muted">{t('bus.closePendingBody')}</p>
            {entries
              .filter((e) => e.status === 'pending')
              .map((e) => (
                <Card key={e.id} className="flex items-center justify-between py-3">
                  <span className="flex items-center gap-2">
                    <Avatar name={e.childName} />
                    <span className="type-body">{e.childName}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => setStatus.mutate({ entryId: e.id, status: 'done' })}
                    >
                      <Check size={16} />
                      {direction === 'to_nursery'
                        ? t('bus.markBoarded')
                        : t('bus.markDelivered')}
                    </Button>
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={() => setStatus.mutate({ entryId: e.id, status: 'absent' })}
                      aria-label={t('bus.markAbsent')}
                    >
                      <X size={16} />
                    </Button>
                  </span>
                </Card>
              ))}
          </div>
        ) : (
          <p className="type-body">
            {t('bus.closeSummary', {
              done: entries.filter((e) => e.status === 'done').length,
              absent: entries.filter((e) => e.status === 'absent').length,
              total: entries.length,
            })}
          </p>
        )}
      </Sheet>

      <Sheet
        open={Boolean(handoverEntry)}
        onClose={() => setHandoverEntry(null)}
        title={t('bus.handedTo')}
        footer={
          <Button
            full
            disabled={!handoverChoice || setStatus.isPending}
            onClick={async () => {
              if (!handoverEntry || !handoverChoice) return
              const doorstep = handoverChoice === 'doorstep'
              await setStatus.mutateAsync({
                entryId: handoverEntry.id,
                status: 'done',
                handedTo: doorstep ? null : handoverChoice,
                doorstep,
              })
              setHandoverEntry(null)
              setHandoverChoice('')
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="type-badge text-muted">{t('bus.handoverHint')}</p>
          <ChipRow>
            {(handoverEntry?.pickupPersons ?? []).map((p) => (
              <Chip
                key={p.id}
                active={handoverChoice === p.id}
                onClick={() => setHandoverChoice(p.id)}
              >
                {p.full_name}
              </Chip>
            ))}
            <Chip
              active={handoverChoice === 'doorstep'}
              onClick={() => setHandoverChoice('doorstep')}
            >
              {t('bus.handedHome')}
            </Chip>
          </ChipRow>
        </div>
      </Sheet>
    </div>
  )
}
