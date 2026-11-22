import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Send, Trash2 } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, TextArea, TextInput } from '../../components/ui/form'
import { ConfirmSheet } from '../../components/ui/ConfirmSheet'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { todayISO } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useAuth } from '../../lib/AuthProvider'
import { invalidatePrefixes } from '../../lib/invalidate'
import { useClasses } from '../classes/hooks'
import { getOrCreateClassDay, listDayChildren } from '../classday/api'
import { useNurserySettings } from '../settings/hooks'
import type { AteAmount, MealEntry, MealKind, Mood } from '../../types/database'
import * as api from './api'
import { childrenWithoutReports } from './publishLogic'

const MEALS: MealKind[] = ['breakfast', 'snack', 'lunch']
const ATE: AteAmount[] = ['all', 'most', 'some', 'none']
const MOODS: Mood[] = ['happy', 'calm', 'sad', 'tired', 'sick']

interface DraftState {
  meals: Record<MealKind, AteAmount>
  source: 'home' | 'nursery'
  napFrom: string
  napTo: string
  napSlept: boolean
  activities: string
  mood: Mood | null
  note: string
}

const EMPTY_DRAFT: DraftState = {
  meals: { breakfast: 'all', snack: 'all', lunch: 'all' },
  source: 'home',
  napFrom: '',
  napTo: '',
  napSlept: true,
  activities: '',
  mood: 'happy',
  note: '',
}

function draftToReport(d: DraftState): api.ReportDraft {
  return {
    meals: MEALS.map((meal) => ({
      meal,
      ate: d.meals[meal],
      source: d.source,
    })) as MealEntry[],
    nap_from: d.napFrom || null,
    nap_to: d.napTo || null,
    nap_slept: d.napSlept,
    activities: d.activities
      .split(/[,،]/)
      .map((a) => a.trim())
      .filter(Boolean),
    mood: d.mood,
    note: d.note.trim() || null,
  }
}

/**
 * التقرير اليومي: اختيار فصل → تعبئة جماعية تُطبَّق على الحاضرين →
 * تعديل المختلف لكل طفل → نشر صريح. الصور من داخل النظام فقط.
 */
export function ReportsPage() {
  const t = useT()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const canReports =
    nursery.status === 'ready' && nursery.can('can_manage_reports')
  const canPhotos = nursery.status === 'ready' && nursery.can('can_manage_photos')
  const { user } = useAuth()
  const qc = useQueryClient()
  const showToast = useToast()
  const classes = useClasses()
  const settings = useNurserySettings()
  const [classId, setClassId] = useState<string>('')
  const date = todayISO()
  const activeClassId = classId || classes.data?.[0]?.id || ''

  const day = useQuery({
    queryKey: ['class-day', nurseryId, activeClassId, date],
    enabled: Boolean(nurseryId && activeClassId),
    queryFn: () => getOrCreateClassDay(nurseryId!, activeClassId, date),
  })
  const dayChildren = useQuery({
    queryKey: ['day-children', nurseryId, activeClassId, day.data?.id],
    enabled: Boolean(nurseryId && activeClassId && day.data?.id),
    queryFn: () => listDayChildren(nurseryId!, activeClassId, day.data!.id),
  })
  const reports = useQuery({
    queryKey: ['day-reports', day.data?.id],
    enabled: Boolean(day.data?.id),
    queryFn: () => api.listReportsForDay(day.data!.id),
  })
  const photos = useQuery({
    queryKey: ['day-photos', day.data?.id],
    enabled: Boolean(day.data?.id),
    queryFn: () => api.listPhotosForDay(day.data!.id),
  })

  const refresh = () =>
    invalidatePrefixes(qc, ['day-reports', 'day-photos', 'home', 'child-photos'])
  const saveReport = useMutation({
    mutationFn: (args: { childId: string; draft: DraftState }) =>
      api.upsertReport(
        nurseryId!,
        day.data!.id,
        args.childId,
        draftToReport(args.draft),
        user?.id ?? null,
      ),
    onSuccess: refresh,
  })
  const publish = useMutation({
    mutationFn: () => api.publishDayReports(day.data!.id),
    onSuccess: () => {
      refresh()
      showToast(t('reports.publishedOk'))
    },
  })

  const [bulk, setBulk] = useState<DraftState>(EMPTY_DRAFT)
  const [editChild, setEditChild] = useState<{ id: string; name: string } | null>(null)
  const [editDraft, setEditDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [publishOpen, setPublishOpen] = useState(false)

  const presentChildren = useMemo(
    () =>
      (dayChildren.data ?? []).filter(
        (d) => d.attendance?.status === 'present' || d.attendance?.status === 'early_leave',
      ),
    [dayChildren.data],
  )
  const reportByChild = useMemo(
    () => new Map((reports.data ?? []).map((r) => [r.child_id, r])),
    [reports.data],
  )
  const unpublishedCount = (reports.data ?? []).filter((r) => !r.published_at).length
  // W2 (3A-374): حاضرون بلا أي تقرير — لن يظهر لهم شيء في البوابة
  const missingReports = childrenWithoutReports(
    presentChildren.map((d) => ({ id: d.child.id, name: d.child.full_name })),
    new Set(reportByChild.keys()),
  )
  const activeClass = (classes.data ?? []).find((c) => c.id === activeClassId)

  const mealLabel = (m: MealKind): string =>
    m === 'breakfast'
      ? t('reports.mealBreakfast')
      : m === 'snack'
        ? t('reports.mealSnack')
        : t('reports.mealLunch')
  const ateLabel = (a: AteAmount): string =>
    a === 'all'
      ? t('reports.ateAll')
      : a === 'most'
        ? t('reports.ateMost')
        : a === 'some'
          ? t('reports.ateSome')
          : t('reports.ateNone')
  const moodLabel = (m: Mood): string =>
    m === 'happy'
      ? t('reports.moodHappy')
      : m === 'calm'
        ? t('reports.moodCalm')
        : m === 'sad'
          ? t('reports.moodSad')
          : m === 'tired'
            ? t('reports.moodTired')
            : t('reports.moodSick')

  function draftForm(draft: DraftState, setDraft: (d: DraftState) => void) {
    return (
      <div className="flex flex-col gap-3">
        {MEALS.map((meal) => (
          <Field key={meal} label={mealLabel(meal)}>
            <ChipRow>
              {ATE.map((a) => (
                <Chip
                  key={a}
                  active={draft.meals[meal] === a}
                  onClick={() =>
                    setDraft({ ...draft, meals: { ...draft.meals, [meal]: a } })
                  }
                >
                  {ateLabel(a)}
                </Chip>
              ))}
            </ChipRow>
          </Field>
        ))}
        <Field label={t('reports.mealSource')}>
          <ChipRow>
            <Chip
              active={draft.source === 'home'}
              onClick={() => setDraft({ ...draft, source: 'home' })}
            >
              {t('reports.sourceHome')}
            </Chip>
            <Chip
              active={draft.source === 'nursery'}
              onClick={() => setDraft({ ...draft, source: 'nursery' })}
            >
              {t('reports.sourceNursery')}
            </Chip>
          </ChipRow>
        </Field>
        {activeClass?.nap_enabled !== false && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('reports.napFrom')}>
              <TextInput
                type="time"
                value={draft.napFrom}
                onChange={(e) => setDraft({ ...draft, napFrom: e.target.value })}
              />
            </Field>
            <Field label={t('reports.napTo')}>
              <TextInput
                type="time"
                value={draft.napTo}
                onChange={(e) => setDraft({ ...draft, napTo: e.target.value })}
              />
            </Field>
          </div>
        )}
        <Field label={t('reports.activities')}>
          <TextInput
            value={draft.activities}
            onChange={(e) => setDraft({ ...draft, activities: e.target.value })}
            placeholder={t('reports.activityPlaceholder')}
          />
        </Field>
        <Field label={t('reports.mood')}>
          <ChipRow>
            {MOODS.map((m) => (
              <Chip
                key={m}
                active={draft.mood === m}
                onClick={() => setDraft({ ...draft, mood: m })}
              >
                {moodLabel(m)}
              </Chip>
            ))}
          </ChipRow>
        </Field>
        <Field label={t('reports.note')}>
          <TextArea
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder={t('reports.notePlaceholder')}
            rows={2}
          />
        </Field>
      </div>
    )
  }

  if (classes.isPending) return <LoadingState />
  if ((classes.data ?? []).length === 0)
    return <EmptyState title={t('classes.emptyTitle')} hint={t('classes.emptyBody')} />

  return (
    <div className="flex flex-col gap-4">
      <ChipRow>
        {(classes.data ?? []).map((c) => (
          <Chip
            key={c.id}
            active={activeClassId === c.id}
            onClick={() => setClassId(c.id)}
          >
            {c.name}
          </Chip>
        ))}
      </ChipRow>

      {day.isPending || dayChildren.isPending || reports.isPending ? (
        <LoadingState />
      ) : day.isError || dayChildren.isError ? (
        <ErrorState
          message={t('common.errorGeneric')}
          onRetry={() => void dayChildren.refetch()}
        />
      ) : (
        <>
          {canReports && (
            <Card>
              <h2 className="type-section mb-1">
                {t('reports.bulkTitle', { class: activeClass?.name ?? '' })}
              </h2>
              <p className="type-badge text-muted mb-3">{t('reports.bulkHint')}</p>
              {draftForm(bulk, setBulk)}
              <Button
                className="mt-3"
                full
                disabled={saveReport.isPending || presentChildren.length === 0}
                onClick={async () => {
                  for (const d of presentChildren) {
                    await saveReport.mutateAsync({ childId: d.child.id, draft: bulk })
                  }
                }}
              >
                {t('reports.applyToAll')}
              </Button>
            </Card>
          )}

          <section className="flex flex-col gap-2">
            {presentChildren.map((d) => {
              const report = reportByChild.get(d.child.id)
              return (
                <Card
                  key={d.child.id}
                  className="flex items-center justify-between py-3 cursor-pointer"
                  onClick={() => {
                    const existing = report
                    setEditDraft(
                      existing
                        ? {
                            meals: {
                              breakfast:
                                (existing.meals.find((m) => m.meal === 'breakfast')
                                  ?.ate as AteAmount) ?? 'all',
                              snack:
                                (existing.meals.find((m) => m.meal === 'snack')
                                  ?.ate as AteAmount) ?? 'all',
                              lunch:
                                (existing.meals.find((m) => m.meal === 'lunch')
                                  ?.ate as AteAmount) ?? 'all',
                            },
                            source:
                              (existing.meals[0]?.source as 'home' | 'nursery') ??
                              'home',
                            napFrom: existing.nap_from?.slice(0, 5) ?? '',
                            napTo: existing.nap_to?.slice(0, 5) ?? '',
                            napSlept: existing.nap_slept ?? true,
                            activities: existing.activities.join(t('format.listSep')),
                            mood: existing.mood ?? 'happy',
                            note: existing.note ?? '',
                          }
                        : bulk,
                    )
                    setEditChild({ id: d.child.id, name: d.child.full_name })
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Avatar name={d.child.full_name} />
                    <span className="type-body">{d.child.full_name}</span>
                  </span>
                  <span
                    className={`type-badge rounded-full px-2 py-1 ${
                      report?.published_at
                        ? 'text-good-text bg-good-soft'
                        : report
                          ? 'text-muted bg-soft'
                          : 'text-bad-text bg-bad-soft'
                    }`}
                  >
                    {report?.published_at
                      ? t('reports.publishedBadge')
                      : report
                        ? t('reports.draftBadge')
                        : t('reports.missingCount', { count: 1 })}
                  </span>
                </Card>
              )
            })}
          </section>

          {canReports && unpublishedCount > 0 && (
            <Button full onClick={() => setPublishOpen(true)}>
              <Send size={18} />
              {t('reports.publish')}
            </Button>
          )}

          <PhotosSection
            nurseryId={nurseryId!}
            classDayId={day.data!.id}
            actorId={user?.id ?? null}
            canPhotos={canPhotos}
            cap={settings.data?.photo_daily_cap ?? null}
            dayChildren={dayChildren.data ?? []}
            photos={photos.data ?? []}
            photosLoading={photos.isPending}
            onChanged={refresh}
          />
        </>
      )}

      <Sheet
        open={Boolean(editChild)}
        onClose={() => setEditChild(null)}
        title={editChild ? t('reports.editChild', { name: editChild.name }) : ''}
        footer={
          <Button
            full
            disabled={saveReport.isPending}
            onClick={async () => {
              if (!editChild) return
              await saveReport.mutateAsync({ childId: editChild.id, draft: editDraft })
              setEditChild(null)
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        {draftForm(editDraft, setEditDraft)}
      </Sheet>

      <ConfirmSheet
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={t('reports.publish')}
        body={
          t('reports.publishConfirm', { count: unpublishedCount }) +
          (missingReports.length > 0
            ? ' ' +
              t('reports.publishMissingWarning', {
                count: missingReports.length,
                names: missingReports.map((c) => c.name).join('، '),
              })
            : '')
        }
        confirmLabel={
          missingReports.length > 0 ? t('reports.publishAnyway') : t('reports.publish')
        }
        onConfirm={async () => {
          await publish.mutateAsync()
          setPublishOpen(false)
        }}
      />
    </div>
  )
}

function PhotosSection({
  nurseryId,
  classDayId,
  actorId,
  canPhotos,
  cap,
  dayChildren,
  photos,
  photosLoading,
  onChanged,
}: {
  nurseryId: string
  classDayId: string
  actorId: string | null
  canPhotos: boolean
  cap: number | null
  dayChildren: Awaited<ReturnType<typeof listDayChildren>>
  photos: Awaited<ReturnType<typeof api.listPhotosForDay>>
  photosLoading: boolean
  onChanged: () => void
}) {
  const t = useT()
  const showToast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [tagged, setTagged] = useState<Set<string>>(new Set())
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<(typeof photos)[number] | null>(null)

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true)
    try {
      if (cap !== null) {
        for (const childId of tagged) {
          const count = await api.countChildPhotosToday(childId, classDayId)
          if (count + files.length > cap) {
            showToast(t('reports.dailyCapReached', { cap }), 'error')
            setUploading(false)
            return
          }
        }
      }
      await api.uploadPhotos(
        nurseryId,
        classDayId,
        actorId,
        files,
        [...tagged],
        caption.trim() || null,
      )
      showToast(t('reports.uploadedOk', { count: files.length }))
      setFiles([])
      setTagged(new Set())
      setCaption('')
      onChanged()
    } catch {
      showToast(t('common.errorGeneric'), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <section>
      <h2 className="type-section mb-2">{t('reports.photos')}</h2>
      {canPhotos && (
        <Card className="mb-3">
          <p className="type-badge text-muted mb-2">{t('reports.addPhotosHint')}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
          <Button variant="soft" full onClick={() => fileRef.current?.click()}>
            <Camera size={18} />
            {t('reports.addPhotos')}
            {files.length > 0 ? ` (${files.length})` : ''}
          </Button>
          {files.length > 0 && (
            <div className="mt-3 flex flex-col gap-3">
              <Field label={t('reports.tagChildren')}>
                <ChipRow>
                  {dayChildren.map((d) => (
                    <Chip
                      key={d.child.id}
                      active={tagged.has(d.child.id)}
                      onClick={() => {
                        const next = new Set(tagged)
                        if (next.has(d.child.id)) next.delete(d.child.id)
                        else next.add(d.child.id)
                        setTagged(next)
                      }}
                    >
                      {d.child.full_name}
                      {!d.child.photo_consent ? ' ⚠' : ''}
                    </Chip>
                  ))}
                </ChipRow>
              </Field>
              <Field label={t('reports.photoCaption')}>
                <TextInput
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </Field>
              <Button onClick={handleUpload} disabled={uploading} full>
                {uploading ? t('reports.uploading') : t('reports.uploadNow')}
              </Button>
            </div>
          )}
        </Card>
      )}
      {photosLoading ? (
        <LoadingState />
      ) : photos.length === 0 ? (
        <p className="type-secondary text-muted">{t('reports.noPhotosYet')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative">
              {p.url ? (
                <img
                  src={p.url}
                  alt={p.caption ?? ''}
                  className="w-full aspect-square object-cover rounded-xl"
                  loading="lazy"
                />
              ) : (
                <div className="w-full aspect-square rounded-xl bg-soft" />
              )}
              {canPhotos && (
                <button
                  className="absolute top-1 end-1 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center cursor-pointer border-0"
                  aria-label={t('reports.deletePhoto')}
                  onClick={() => setDeleteTarget(p)}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmSheet
        danger
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t('reports.deletePhoto')}
        body={t('common.dangerConfirmTitle')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteTarget) await api.deletePhoto(deleteTarget)
          setDeleteTarget(null)
          onChanged()
        }}
      />
    </section>
  )
}
