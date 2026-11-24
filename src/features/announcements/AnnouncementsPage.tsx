import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Plus, Send, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, Select, TextArea, TextInput } from '../../components/ui/form'
import { DangerConfirmSheet } from '../../components/ui/DangerConfirmSheet'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Sheet } from '../../components/ui/Sheet'
import { useT } from '../../i18n'
import { formatDateTimeAr } from '../../lib/format'
import { requireSupabase } from '../../lib/supabase'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useAuth } from '../../lib/AuthProvider'
import { invalidatePrefixes } from '../../lib/invalidate'
import { useClasses } from '../classes/hooks'
import type { AnnouncementRow } from '../../types/database'

/** إعلانات الحضانة: مسودة → نشر يظهر في بوابات الأهالي فوراً */
export function AnnouncementsPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const canManage =
    nursery.status === 'ready' && nursery.can('can_manage_announcements')
  const { user } = useAuth()
  const qc = useQueryClient()
  const classes = useClasses()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'class'>('all')
  const [wantsRsvp, setWantsRsvp] = useState(false)
  const [classId, setClassId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementRow | null>(null)

  const announcements = useQuery({
    queryKey: ['announcements', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: async (): Promise<AnnouncementRow[]> => {
      const db = requireSupabase()
      const { data, error } = await db
        .from('announcements')
        .select('*')
        .eq('nursery_id', nurseryId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AnnouncementRow[]
    },
  })
  const refresh = () => invalidatePrefixes(qc, ['announcements'])
  const create = useMutation({
    mutationFn: async (publish: boolean) => {
      const db = requireSupabase()
      const { error } = await db.from('announcements').insert({
        nursery_id: nurseryId!,
        title: title.trim(),
        body: body.trim(),
        audience,
        wants_rsvp: wantsRsvp,
        class_id: audience === 'class' ? classId || null : null,
        published_at: publish ? new Date().toISOString() : null,
        created_by: user?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      refresh()
      setSheetOpen(false)
      setTitle('')
      setBody('')
    },
  })
  const publish = useMutation({
    mutationFn: async (id: string) => {
      const db = requireSupabase()
      const { error } = await db
        .from('announcements')
        .update({ published_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const db = requireSupabase()
      const { error } = await db.from('announcements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })

  if (announcements.isPending) return <LoadingState />
  if (announcements.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void announcements.refetch()}
      />
    )
  const list = announcements.data ?? []

  return (
    <div className="flex flex-col gap-2">
      {canManage && (
        <Button variant="soft" onClick={() => setSheetOpen(true)}>
          <Plus size={16} />
          {t('announcements.add')}
        </Button>
      )}
      {list.length === 0 ? (
        <EmptyState
          title={t('announcements.emptyTitle')}
          hint={t('announcements.emptyBody')}
          icon={Megaphone}
        />
      ) : (
        list.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between">
              <div>
                <div className="type-body font-semibold">{a.title}</div>
                <p className="type-secondary whitespace-pre-wrap">{a.body}</p>
                <div className="type-badge text-muted mt-1">
                  {a.published_at
                    ? `${t('announcements.publishedBadge')} — ${formatDateTimeAr(a.published_at)}`
                    : t('announcements.draftBadge')}
                  {a.audience === 'class' && ' • 🎯'}
                </div>
                {a.published_at && (
                  <CircularStats announcementId={a.id} wantsRsvp={a.wants_rsvp} />
                )}
              </div>
              {canManage && (
                <span className="flex gap-1">
                  {!a.published_at && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => publish.mutate(a.id)}
                      aria-label={t('announcements.publish')}
                    >
                      <Send size={16} />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteTarget(a)}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 size={16} />
                  </Button>
                </span>
              )}
            </div>
          </Card>
        ))
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('announcements.add')}
        footer={
          <span className="flex gap-2">
            <Button
              variant="soft"
              className="flex-1"
              disabled={!title.trim() || !body.trim() || create.isPending}
              onClick={() => create.mutate(false)}
            >
              {t('common.save')}
            </Button>
            <Button
              className="flex-1"
              disabled={!title.trim() || !body.trim() || create.isPending}
              onClick={() => create.mutate(true)}
            >
              <Send size={16} />
              {t('announcements.publish')}
            </Button>
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('announcements.headline')}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('announcements.body')}>
            <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </Field>
          <Field label={t('announcements.audienceLabel')}>
            <ChipRow>
              <Chip active={audience === 'all'} onClick={() => setAudience('all')}>
                {t('announcements.audienceAll')}
              </Chip>
              <Chip active={audience === 'class'} onClick={() => setAudience('class')}>
                {t('announcements.audienceClass')}
              </Chip>
            </ChipRow>
          </Field>
          <Field label={t('announcements.rsvpLabel')}>
            <ChipRow>
              <Chip active={wantsRsvp} onClick={() => setWantsRsvp(true)}>
                {t('announcements.rsvpYes')}
              </Chip>
              <Chip active={!wantsRsvp} onClick={() => setWantsRsvp(false)}>
                {t('announcements.rsvpNo')}
              </Chip>
            </ChipRow>
          </Field>
          {audience === 'class' && (
            <Field label={t('children.class')}>
              <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">—</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Sheet>

      <DangerConfirmSheet
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('common.delete')}
        entityName={deleteTarget?.title ?? ''}
        lines={[t('announcements.deleteConfirm')]}
        mode="delete"
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleteTarget) {
            void remove.mutateAsync(deleteTarget.id).then(() => setDeleteTarget(null))
          }
        }}
      />
    </div>
  )
}


function CircularStats({
  announcementId,
  wantsRsvp,
}: {
  announcementId: string
  wantsRsvp: boolean
}) {
  const t = useT()
  const stats = useQuery({
    queryKey: ['circular-stats', announcementId],
    queryFn: async () => {
      const db = requireSupabase()
      const reads = await db
        .from('circular_reads')
        .select('guardian_id', { count: 'exact' })
        .eq('announcement_id', announcementId)
      const readCount = reads.count ?? (reads.data ?? []).length
      let attending = 0
      let guests = 0
      let declined = 0
      if (wantsRsvp) {
        const rsvps = await db
          .from('circular_rsvps')
          .select('attending, guests')
          .eq('announcement_id', announcementId)
        for (const r of (rsvps.data ?? []) as {
          attending: boolean
          guests: number
        }[]) {
          if (r.attending) {
            attending += 1
            guests += r.guests
          } else {
            declined += 1
          }
        }
      }
      return { readCount, attending, guests, declined }
    },
  })
  if (!stats.data) return null
  return (
    <div className="type-badge text-muted mt-1">
      {t('announcements.readBy', { count: stats.data.readCount })}
      {wantsRsvp &&
        ` • ${t('announcements.rsvpSummary', {
          attending: stats.data.attending,
          guests: stats.data.guests,
          declined: stats.data.declined,
        })}`}
    </div>
  )
}
