import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Download, Moon, Send, Shapes, Smile, Trash2, UtensilsCrossed } from 'lucide-react'
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
import { childrenWithoutReports, reportAccessFor } from './publishLogic'
import { enqueuePhoto, enqueueReport } from './offlineQueue'
import { useReportsOfflineSync } from './hooks'
import { Mic, Printer } from 'lucide-react'
import { openPrintDocument } from '../../lib/printDoc'
import { MAX_PHOTO_BYTES } from './photoUtils'
import { makeStopFlag, type StopFlag } from '../../lib/bulk'

const MEALS: MealKind[] = ['breakfast', 'snack', 'lunch']
const ATE: AteAmount[] = ['all', 'most', 'some', 'none']
const MOODS: Mood[] = ['happy', 'calm', 'sad', 'tired', 'sick']

type ReportTab = 'notWritten' | 'ready' | 'sent'

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
 * قالب الـ3 نقرات (4.1): نقرة واحدة لكل بُعد (أكل/نوم/مزاج)
 * تُطبَّق على الفصل كله — بدل ١٠+ نقرات في النموذج الكامل تحتها.
 */
function QuickBar({
  draft,
  setDraft,
}: {
  draft: DraftState
  setDraft: (d: DraftState) => void
}) {
  const t = useT()
  const allMeals = (ate: AteAmount) => ({
    breakfast: ate,
    snack: ate,
    lunch: ate,
  })
  return (
    <div className="flex flex-col gap-2 mb-3 rounded-2xl bg-soft p-3">
      <div className="type-secondary">{t('reports.quickTitle')}</div>
      <ChipRow>
        <Chip
          active={draft.meals.lunch === 'all'}
          onClick={() => setDraft({ ...draft, meals: allMeals('all') })}
        >
          {t('reports.quickAteAll')}
        </Chip>
        <Chip
          active={draft.meals.lunch === 'some'}
          onClick={() => setDraft({ ...draft, meals: allMeals('some') })}
        >
          {t('reports.quickAteSome')}
        </Chip>
        <Chip
          active={draft.meals.lunch === 'none'}
          onClick={() => setDraft({ ...draft, meals: allMeals('none') })}
        >
          {t('reports.quickAteNone')}
        </Chip>
      </ChipRow>
      <ChipRow>
        <Chip
          active={draft.napSlept}
          onClick={() => setDraft({ ...draft, napSlept: true })}
        >
          {t('reports.quickSlept')}
        </Chip>
        <Chip
          active={!draft.napSlept}
          onClick={() => setDraft({ ...draft, napSlept: false })}
        >
          {t('reports.quickNoSleep')}
        </Chip>
      </ChipRow>
      <ChipRow>
        <Chip
          active={draft.mood === 'happy'}
          onClick={() => setDraft({ ...draft, mood: 'happy' })}
        >
          {t('reports.moodHappy')}
        </Chip>
        <Chip
          active={draft.mood === 'calm'}
          onClick={() => setDraft({ ...draft, mood: 'calm' })}
        >
          {t('reports.moodCalm')}
        </Chip>
        <Chip
          active={draft.mood === 'tired'}
          onClick={() => setDraft({ ...draft, mood: 'tired' })}
        >
          {t('reports.moodTired')}
        </Chip>
      </ChipRow>
    </div>
  )
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

/** إدخال صوتي للملحوظة (4.1): Web Speech حيثما توفر — يختفي بصمت عند غيابه */
function VoiceNoteButton({ onText }: { onText: (txt: string) => void }) {
  const t = useT()
  const [listening, setListening] = useState(false)
  const Ctor = (
    window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
  )
  const Impl = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition
  if (!Impl) return null
  const toggle = () => {
    if (listening) return
    const rec = new Impl()
    rec.lang = 'ar-EG'
    rec.interimResults = false
    rec.onresult = (e) => {
      const txt = e.results[0]?.[0]?.transcript ?? ''
      if (txt) onText(txt)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="type-badge text-primary mt-1 inline-flex items-center gap-1"
    >
      <Mic size={14} />
      {listening ? t('reports.voiceListening') : t('reports.voiceNote')}
    </button>
  )
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
    // networkMode always (درس 0.1): بلا اتصال يجب أن يفشل الاستدعاء
    // فوراً فيُطابَق التقرير محلياً بدل أن يعلّق في ذاكرة React Query
    networkMode: 'always',
    mutationFn: async (args: { childId: string; draft: DraftState }) => {
      const fields = draftToReport(args.draft)
      try {
        await api.upsertReport(
          nurseryId!,
          day.data!.id,
          args.childId,
          fields,
          user?.id ?? null,
        )
      } catch (err) {
        if (err instanceof Error && err.message === 'report_for_absent_child') {
          throw err
        }
        enqueueReport({
          nurseryId: nurseryId!,
          classDayId: day.data!.id,
          childId: args.childId,
          draft: fields,
          actorId: user?.id ?? null,
        })
        recountQueued()
        throw new Error('queued_offline')
      }
    },
    onSuccess: refresh,
  })
  const publish = useMutation({
    mutationFn: () => api.publishDayReports(day.data!.id),
    onSuccess: () => {
      refresh()
      showToast(t('reports.publishedOk'))
    },
  })
  const { queued, recountQueued } = useReportsOfflineSync(nurseryId ?? null)

  const [bulk, setBulk] = useState<DraftState>(EMPTY_DRAFT)
  const bulkStopRef = useRef<StopFlag>(makeStopFlag())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [editChild, setEditChild] = useState<{ id: string; name: string } | null>(null)
  const [editDraft, setEditDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [publishOpen, setPublishOpen] = useState(false)
  const [tabSel, setTabSel] = useState<ReportTab | null>(null)

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

  // هوية نونو — الموجة 3: تبويبات حالة التقرير + بطاقة بأقسام ثابتة.
  // الحالات مشتقة من نفس بيانات اليوم (لا منطق جديد): غائب ببطاقته
  // المعطلة كما هي داخل تبويب «لسه» ولا يُحسب في عدّاده.
  const listedChildren = (dayChildren.data ?? []).filter(
    (d) => reportAccessFor(d.attendance?.status) !== 'unmarked',
  )
  const childState = (d: (typeof listedChildren)[number]): ReportTab | 'absent' => {
    if (reportAccessFor(d.attendance?.status) === 'absent') return 'absent'
    const r = reportByChild.get(d.child.id)
    return r?.published_at ? 'sent' : r ? 'ready' : 'notWritten'
  }
  const tabCounts: Record<ReportTab, number> = {
    notWritten: listedChildren.filter((d) => childState(d) === 'notWritten').length,
    ready: listedChildren.filter((d) => childState(d) === 'ready').length,
    sent: listedChildren.filter((d) => childState(d) === 'sent').length,
  }
  const tab: ReportTab = tabSel ?? (tabCounts.ready > 0 ? 'ready' : 'notWritten')
  const visibleChildren = listedChildren.filter((d) => {
    const st = childState(d)
    return tab === 'notWritten' ? st === 'notWritten' || st === 'absent' : st === tab
  })
  const photosByChild = useMemo(() => {
    const map = new Map<string, NonNullable<typeof photos.data>>()
    for (const p of photos.data ?? []) {
      for (const cid of p.childIds) {
        const arr = map.get(cid) ?? []
        arr.push(p)
        map.set(cid, arr)
      }
    }
    return map
  }, [photos.data])

  const openEditor = (childId: string, childName: string) => {
    const existing = reportByChild.get(childId)
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
              (existing.meals[0]?.source as 'home' | 'nursery') ?? 'home',
            napFrom: existing.nap_from?.slice(0, 5) ?? '',
            napTo: existing.nap_to?.slice(0, 5) ?? '',
            napSlept: existing.nap_slept ?? true,
            activities: existing.activities.join(t('format.listSep')),
            mood: existing.mood ?? 'happy',
            note: existing.note ?? '',
          }
        : bulk,
    )
    setEditChild({ id: childId, name: childName })
  }

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
          <VoiceNoteButton
            onText={(txt) =>
              setDraft({
                ...draft,
                note: (draft.note ? draft.note + ' ' : '') + txt,
              })
            }
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
              <QuickBar draft={bulk} setDraft={setBulk} />
              {draftForm(bulk, setBulk)}
              <Button
                className="mt-3"
                full
                disabled={saveReport.isPending || presentChildren.length === 0}
                onClick={async () => {
                  bulkStopRef.current = makeStopFlag()
                  setBulkSaving(true)
                  let savedCount = 0
                  try {
                    for (const d of presentChildren) {
                      if (bulkStopRef.current.shouldStop()) {
                        showToast(
                          t('common.bulkStopped', {
                            done: savedCount,
                            total: presentChildren.length,
                          }),
                        )
                        return
                      }
                      await saveReport.mutateAsync({ childId: d.child.id, draft: bulk })
                      savedCount += 1
                    }
                  } catch (err) {
                    if (err instanceof Error && err.message === 'queued_offline') {
                      showToast(t('reports.savedOffline'))
                    } else {
                      showToast(t('common.errorGeneric'), 'error')
                    }
                  } finally {
                    setBulkSaving(false)
                  }
                }}
              >
                {t('reports.applyToAll')}
              </Button>
              {presentChildren.length === 0 && (
                <p className="type-badge text-muted mt-2">{t('reports.noPresentHint')}</p>
              )}
              {bulkSaving && (
                <Button
                  variant="soft"
                  className="mt-2"
                  full
                  onClick={() => bulkStopRef.current.stop()}
                >
                  {t('common.stop')}
                </Button>
              )}
            </Card>
          )}

          <ChipRow>
            {(
              [
                ['notWritten', t('reports.tabNotWritten'), tabCounts.notWritten],
                ['ready', t('reports.tabReady'), tabCounts.ready],
                ['sent', t('reports.tabSent'), tabCounts.sent],
              ] as [ReportTab, string, number][]
            ).map(([key, label, count]) => (
              <Chip key={key} active={tab === key} onClick={() => setTabSel(key)}>
                {label} • {count}
              </Chip>
            ))}
          </ChipRow>

          <section className="flex flex-col gap-2">
            {visibleChildren.length === 0 ? (
              <EmptyState
                title={
                  tab === 'notWritten'
                    ? t('reports.emptyNotWritten')
                    : tab === 'ready'
                      ? t('reports.emptyReady')
                      : t('reports.emptySent')
                }
              />
            ) : (
              visibleChildren.map((d) => {
                const report = reportByChild.get(d.child.id)
                const state = childState(d)
                // X2 (3A-378): الغائب/في إجازة يظهر بشارة «غائب» وبطاقته
                // معطلة — لا كتابة تقرير ولا نشر لمن لم يحضر.
                if (state === 'absent') {
                  return (
                    <Card
                      key={d.child.id}
                      className="flex items-center justify-between py-3 opacity-70"
                    >
                      <span className="flex items-center gap-2">
                        <Avatar name={d.child.full_name} />
                        <span className="type-body">{d.child.full_name}</span>
                      </span>
                      <span className="type-badge rounded-full px-2 py-1 text-bad-text bg-bad-soft">
                        {t('reports.absentBadge')}
                      </span>
                    </Card>
                  )
                }
                if (state === 'notWritten' || !report) {
                  return (
                    <Card
                      key={d.child.id}
                      className="flex items-center justify-between py-3 cursor-pointer"
                      onClick={() => openEditor(d.child.id, d.child.full_name)}
                    >
                      <span className="flex items-center gap-2">
                        <Avatar name={d.child.full_name} />
                        <span className="type-body">{d.child.full_name}</span>
                      </span>
                      <span className="type-badge text-accent-text font-semibold">
                        {t('reports.writeReport')}
                      </span>
                    </Card>
                  )
                }
                const lunchAte =
                  (report.meals.find((m) => m.meal === 'lunch')
                    ?.ate as AteAmount) ?? 'all'
                const napValue = report.nap_slept
                  ? report.nap_from && report.nap_to
                    ? `${report.nap_from.slice(0, 5)} – ${report.nap_to.slice(0, 5)}`
                    : t('reports.napSlept')
                  : t('reports.quickNoSleep')
                const childPhotos = photosByChild.get(d.child.id) ?? []
                const tiles: { icon: ReactNode; value: string; label: string }[] = [
                  {
                    icon: <UtensilsCrossed size={17} />,
                    value: ateLabel(lunchAte),
                    label: t('reports.tileMeals'),
                  },
                  {
                    icon: <Moon size={17} />,
                    value: napValue,
                    label: t('reports.nap'),
                  },
                  {
                    icon: <Shapes size={17} />,
                    value: report.activities[0] ?? '—',
                    label:
                      report.activities.length > 1
                        ? `${t('reports.activities')} ${t('reports.moreActivities', { count: report.activities.length - 1 })}`
                        : t('reports.activities'),
                  },
                  {
                    icon: <Smile size={17} />,
                    value: report.mood ? moodLabel(report.mood) : '—',
                    label: t('reports.mood'),
                  },
                ]
                return (
                  <Card
                    key={d.child.id}
                    className="flex flex-col gap-3 cursor-pointer"
                    onClick={() => openEditor(d.child.id, d.child.full_name)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Avatar name={d.child.full_name} />
                        <span className="type-body font-semibold">{d.child.full_name}</span>
                      </span>
                      <span
                        className={`type-badge rounded-full px-2 py-1 ${
                          state === 'sent'
                            ? 'text-good-text bg-good-soft'
                            : 'text-muted bg-soft'
                        }`}
                      >
                        {state === 'sent'
                          ? t('reports.publishedBadge')
                          : t('reports.draftBadge')}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {tiles.map((tile, i) => (
                        <div
                          key={i}
                          className="bg-soft rounded-xl px-1 py-2 text-center flex flex-col items-center gap-0.5 min-w-0"
                        >
                          <span className="text-primary">{tile.icon}</span>
                          <span className="type-badge font-semibold truncate max-w-full">
                            {tile.value}
                          </span>
                          <span className="type-badge text-muted truncate max-w-full">
                            {tile.label}
                          </span>
                        </div>
                      ))}
                    </div>
                    {childPhotos.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto">
                        {childPhotos.slice(0, 6).map((p) =>
                          p.url ? (
                            <img
                              key={p.id}
                              src={p.url}
                              alt={p.caption ?? ''}
                              className="w-14 h-14 rounded-2xl object-cover shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <div key={p.id} className="w-14 h-14 rounded-2xl bg-soft shrink-0" />
                          ),
                        )}
                      </div>
                    )}
                  </Card>
                )
              })
            )}
          </section>

          {queued > 0 && (
            <span className="type-badge text-bad-text bg-bad-soft rounded-full px-2 py-1 self-start">
              {t('reports.syncPending', { count: queued })}
            </span>
          )}

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
          <div className="flex gap-2">
          <Button
            full
            disabled={saveReport.isPending}
            onClick={async () => {
              if (!editChild) return
              try {
                await saveReport.mutateAsync({ childId: editChild.id, draft: editDraft })
                setEditChild(null)
              } catch (err) {
                // X2 (3A-378): الورقة اتفتحت والطفل حاضر، واتسجّل غايب
                // أثناء التعديل — الرفض برسالة واضحة بدل صمت.
                if (err instanceof Error && err.message === 'queued_offline') {
                  showToast(t('reports.savedOffline'))
                  setEditChild(null)
                } else {
                  showToast(
                    err instanceof Error && err.message === 'report_for_absent_child'
                      ? t('reports.reportAbsentBlocked')
                      : t('common.errorGeneric'),
                    'error',
                  )
                }
              }
            }}
          >
            {t('common.save')}
          </Button>
          <Button
            variant="soft"
            onClick={() => {
              if (!editChild || nursery.status !== 'ready') return
              const mealRows = (Object.keys(editDraft.meals) as MealKind[]).map(
                (m) => ({
                  label: mealLabel(m),
                  value: ateLabel(editDraft.meals[m]),
                }),
              )
              const opened = openPrintDocument({
                nurseryName: nursery.nursery.name,
                logoUrl: nursery.nursery.logo_url,
                brandColor: nursery.nursery.brand_color,
                title: t('reports.printTitle', { name: editChild.name }),
                meta: date,
                sections: [
                  {
                    type: 'kv',
                    rows: [
                      ...mealRows,
                      {
                        label: t('reports.nap'),
                        value: editDraft.napSlept
                          ? t('reports.quickSlept')
                          : t('reports.quickNoSleep'),
                      },
                      {
                        label: t('reports.mood'),
                        value: editDraft.mood ? moodLabel(editDraft.mood) : '—',
                      },
                    ],
                  },
                  ...(editDraft.activities.trim()
                    ? [{ type: 'text' as const, text: editDraft.activities.trim() }]
                    : []),
                  ...(editDraft.note.trim()
                    ? [{ type: 'text' as const, text: editDraft.note.trim() }]
                    : []),
                ],
                footerNote: t('pub.poweredBy'),
              })
              if (!opened) showToast(t('common.errorGeneric'), 'error')
            }}
          >
            <Printer size={16} />
            {t('reports.printReport')}
          </Button>
          </div>
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
                names: missingReports.map((c) => c.name).join(', '),
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
  const uploadStopRef = useRef<StopFlag>(makeStopFlag())
  const [files, setFiles] = useState<File[]>([])
  const [tagged, setTagged] = useState<Set<string>>(new Set())
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<(typeof photos)[number] | null>(null)
  const [failedPhotos, setFailedPhotos] = useState<Set<string>>(new Set())

  async function handleUpload() {
    if (files.length === 0) return
    setUploading(true)
    try {
      // X3 (3A-378): دفاع ثانٍ بعد تعطيل الشريحة — لو تغيّرت الموافقة
      // بعد تحميل الصفحة، الرفع يترفض قبل أي تخزين أو ربط.
      const blocked = dayChildren.find(
        (d) => tagged.has(d.child.id) && !d.child.photo_consent,
      )
      if (blocked) {
        showToast(
          t('reports.uploadNoConsent', { name: blocked.child.full_name }),
          'error',
        )
        return
      }
      // W3 (3A-374): سقف حجم صارم قبل أي رفع — رسالة ودية باسم الملف
      const tooBig = files.find((f) => f.size > MAX_PHOTO_BYTES)
      if (tooBig) {
        showToast(t('reports.photoTooLarge', { name: tooBig.name, max: 8 }), 'error')
        setUploading(false)
        return
      }
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
    } catch (err) {
      const offline =
        !navigator.onLine ||
        (err instanceof Error && /failed to fetch|network/i.test(err.message))
      if (offline) {
        for (const f of files) {
          await enqueuePhoto({
            nurseryId,
            classDayId,
            childIds: [...tagged],
            caption: caption.trim() || null,
            actorId,
            blob: f,
          })
        }
        showToast(t('reports.savedOffline'))
        setFiles([])
        setTagged(new Set())
        setCaption('')
        onChanged()
      } else {
        showToast(t('common.errorGeneric'), 'error')
      }
    } finally {
      setUploading(false)
    }
  }

  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const { blob, count } = await api.downloadDayPhotosZip(classDayId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nounou-photos-${classDayId.slice(0, 8)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      showToast(t('reports.exportedPhotos', { count }))
    } catch {
      showToast(t('common.errorGeneric'), 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section>
      <h2 className="type-section mb-2">{t('reports.photos')}</h2>
      {photos.length > 0 && (
        <Button
          variant="soft"
          full
          className="mb-3"
          disabled={exporting}
          onClick={() => void handleExport()}
        >
          <Download size={18} />
          {exporting ? t('reports.exportingPhotos') : t('reports.exportPhotos')}
        </Button>
      )}
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
                      disabled={!d.child.photo_consent}
                      onClick={() => {
                        const next = new Set(tagged)
                        if (next.has(d.child.id)) next.delete(d.child.id)
                        else next.add(d.child.id)
                        setTagged(next)
                      }}
                    >
                      {d.child.full_name}
                      {!d.child.photo_consent ? ` (${t('reports.noConsent')})` : ''}
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
              <div className="flex gap-2">
                <Button onClick={handleUpload} disabled={uploading} full>
                  {uploading ? t('reports.uploading') : t('reports.uploadNow')}
                </Button>
                {uploading && (
                  <Button variant="soft" onClick={() => uploadStopRef.current.stop()}>
                    {t('common.stop')}
                  </Button>
                )}
              </div>
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
              {p.url && !failedPhotos.has(p.id) ? (
                <img
                  src={p.url}
                  alt={p.caption ?? ''}
                  className="w-full aspect-square object-cover rounded-2xl"
                  loading="lazy"
                  onError={() =>
                    setFailedPhotos((prev) => new Set(prev).add(p.id))
                  }
                />
              ) : (
                <div className="w-full aspect-square rounded-2xl bg-soft flex items-center justify-center px-2">
                  <span className="type-badge text-muted text-center">
                    {t('reports.photoLoadFailed')}
                  </span>
                </div>
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
