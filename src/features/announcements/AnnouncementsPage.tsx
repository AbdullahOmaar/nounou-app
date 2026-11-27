import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Megaphone, Plus, Send, Trash2 } from 'lucide-react'
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


/**
 * تنبيه واتساب عند النشر (3.11): يمر عبر بوابات 2.2 — يُسجَّل في
 * السجل دائماً ولا يُرسل فعلياً قبل وجود المرسل. مالك فقط (قيد
 * الـRPC) وأفضل جهد: فشله لا يُفشل النشر أبداً.
 */
async function enqueueAnnouncementAlert(
  nurseryId: string,
  title: string,
  isOwner: boolean,
  audience: string,
  classId: string | null,
): Promise<void> {
  if (!isOwner) return
  try {
    const db = requireSupabase()
    let guardianIds: string[]
    if (audience === 'class' && classId) {
      // منشور فصل: أوصياء أطفال الفصل النشطين فقط (زي جرس 0030)
      const { data: enr } = await db
        .from('enrollments')
        .select('child_id')
        .eq('nursery_id', nurseryId)
        .eq('class_id', classId)
        .eq('status', 'active')
        .limit(1000)
      const childIds = [...new Set(
        ((enr ?? []) as { child_id: string }[]).map((r) => r.child_id),
      )]
      if (childIds.length === 0) return
      const { data: links } = await db
        .from('guardian_children')
        .select('guardian_id')
        .in('child_id', childIds)
        .limit(1000)
      guardianIds = [...new Set(
        ((links ?? []) as { guardian_id: string }[]).map((r) => r.guardian_id),
      )]
    } else {
      const { data } = await db
        .from('guardians')
        .select('id')
        .eq('nursery_id', nurseryId)
        .limit(500) // حد أمان لا هدف: أكبر حضانة متوقعة داخل النطاق
      guardianIds = ((data ?? []) as { id: string }[]).map((g) => g.id)
    }
    for (const gid of guardianIds) {
      try {
        await db.rpc('whatsapp_enqueue', {
          p_nursery: nurseryId,
          p_guardian: gid,
          p_template: 'announcement',
          p_params: { title },
        })
      } catch {
        // أفضل جهد لكل وصي — البوابة سجّلت أو رفضت، النشر تم
      }
    }
  } catch {
    // التنبيه لا يُفشل النشر
  }
}

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
  const [archiveOpen, setArchiveOpen] = useState(false)

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
      return publish
    },
    onSuccess: (wasPublish) => {
      refresh()
      setSheetOpen(false)
      if (wasPublish) {
        void enqueueAnnouncementAlert(
          nurseryId!,
          title.trim(),
          nursery.status === 'ready' && nursery.isOwner,
          audience,
          audience === 'class' ? classId || null : null,
        )
      }
      setTitle('')
      setBody('')
    },
  })
  const publish = useMutation({
    mutationFn: async (a: AnnouncementRow) => {
      const db = requireSupabase()
      const { error } = await db
        .from('announcements')
        .update({ published_at: new Date().toISOString() })
        .eq('id', a.id)
      if (error) throw error
      return a
    },
    onSuccess: (a) => {
      refresh()
      void enqueueAnnouncementAlert(
        nurseryId!,
        a.title,
        nursery.status === 'ready' && nursery.isOwner,
        a.audience,
        a.class_id,
      )
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const db = requireSupabase()
      const { error } = await db.from('announcements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: refresh,
  })

  // هوية نونو — الموجة 3: مسودات أولًا، أحدث 3 منشورة بشارة «جديد»
  // وحافة كهرمانية، والباقي أرشيف مطوي. البطاقة نفسها كما هي.
  const announcementCard = (a: AnnouncementRow, isNew: boolean) => (
    <Card key={a.id} className={isNew ? 'border-e-4 border-accent' : undefined}>
      <div className="flex items-start justify-between">
        <div>
          <div className="type-body font-semibold flex items-center gap-2">
            {a.title}
            {isNew && (
              <span className="type-badge text-accent-text font-semibold">
                {t('announcements.newBadge')}
              </span>
            )}
          </div>
          <p className="type-secondary whitespace-pre-wrap">{a.body}</p>
          <div className="type-badge text-muted mt-1">
            {a.published_at
              ? `${t('announcements.publishedBadge')} — ${formatDateTimeAr(a.published_at)}`
              : t('announcements.draftBadge')}
            {a.audience === 'class' &&
              ` • ${t('announcements.classAudience', {
                name:
                  (classes.data ?? []).find((c) => c.id === a.class_id)?.name ?? '',
              })}`}
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
                onClick={() => publish.mutate(a)}
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
  )

  if (announcements.isPending) return <LoadingState />
  if (announcements.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void announcements.refetch()}
      />
    )
  const list = announcements.data ?? []
  const drafts = list.filter((a) => !a.published_at)
  const publishedList = list.filter((a) => a.published_at)
  const latest = publishedList.slice(0, 3)
  const archive = publishedList.slice(3)

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
        <>
          {drafts.length > 0 && (
            <>
              <h2 className="type-section mt-1">{t('announcements.draftsTitle')}</h2>
              {drafts.map((a) => announcementCard(a, false))}
            </>
          )}
          {latest.length > 0 && (
            <>
              <h2 className="type-section mt-1">{t('announcements.latestTitle')}</h2>
              {latest.map((a) => announcementCard(a, true))}
            </>
          )}
          {archive.length > 0 && (
            <>
              <button
                type="button"
                className="flex items-center justify-between w-full bg-transparent border-0 cursor-pointer text-text py-1"
                aria-expanded={archiveOpen}
                onClick={() => setArchiveOpen((v) => !v)}
              >
                <span className="type-section">
                  {t('announcements.archiveTitle')} ({archive.length})
                </span>
                <ChevronDown
                  size={20}
                  className={`text-muted transition-transform ${archiveOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {archiveOpen && archive.map((a) => announcementCard(a, false))}
            </>
          )}
        </>
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
