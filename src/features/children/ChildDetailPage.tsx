import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Archive, BookOpen, Link2, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { openPrintDocument } from '../../lib/printDoc'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, Field, Select, TextArea, TextInput } from '../../components/ui/form'
import { DangerConfirmSheet } from '../../components/ui/DangerConfirmSheet'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { ageLabel, formatClock12, todayISO, waLink } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useClasses } from '../classes/hooks'
import { useChildAttendance } from '../classday/hooks'
import { ChildPaymentsTab } from '../invoices/ChildPaymentsTab'
import { useNurserySettings } from '../settings/hooks'
import * as portalApi from '../portal/api'
import * as reportsApi from '../reports/api'
import type {
  AllergyEntry,
  ChildHealthProfileRow,
  MedicationScheduleRow,
  PickupRelation,
} from '../../types/database'
import { useChild, useChildMutations } from './hooks'

type Tab = 'overview' | 'health' | 'attendance' | 'payments' | 'photos'

const RELATIONS: PickupRelation[] = ['father', 'mother', 'grandparent', 'driver', 'other']

/**
 * ملف الطفل: نظرة عامة (أوصياء + استلام + رابط البوابة) / صحة / حضور /
 * مدفوعات (مالك) / صور. مركز كل ما يخص الطفل في التشغيل اليومي.
 */
export function ChildDetailPage() {
  const t = useT()
  const { childId } = useParams()
  const nursery = useCurrentNursery()
  const isOwner = nursery.status === 'ready' && nursery.isOwner
  const canManage =
    nursery.status === 'ready' && nursery.can('can_manage_children')
  const bundle = useChild(childId)
  const mutations = useChildMutations()
  const classes = useClasses()
  const settings = useNurserySettings()
  const showToast = useToast()
  const [tab, setTab] = useState<Tab>('overview')
  const [guardianOpen, setGuardianOpen] = useState(false)
  const [pickupOpen, setPickupOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [freshLink, setFreshLink] = useState<string | null>(null)
  const [growthBusy, setGrowthBusy] = useState(false)

  // الحضور يُجلب دائمًا (مش بس في تبويبه): شارة حالة اليوم في الترويسة
  // بتقرأ صف النهارده منه — نفس الاستعلام المخزّن بنفس المفتاح.
  const attendance = useChildAttendance(childId)
  const photos = useQuery({
    queryKey: ['child-photos', childId],
    enabled: Boolean(childId && tab === 'photos'),
    queryFn: () => reportsApi.listChildPhotos(childId!),
  })
  const tokens = useQuery({
    queryKey: ['child-tokens', bundle.data?.guardians[0]?.id],
    enabled: Boolean(bundle.data?.guardians[0]?.id),
    queryFn: () =>
      portalApi.listTokens(
        nursery.status === 'ready' ? nursery.nurseryId : '',
        bundle.data!.guardians[0].id,
      ),
  })

  if (bundle.isPending) return <LoadingState />
  if (bundle.isError || !bundle.data)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void bundle.refetch()}
      />
    )
  const { child, enrollment, classRow, guardians, pickupPersons, health, medications } =
    bundle.data
  const payer = guardians.find((g) => g.is_payer) ?? guardians[0]
  const activeToken = (tokens.data ?? []).find(
    (tk) => !tk.revoked_at && new Date(tk.expires_at) > new Date(),
  )

  const todayRow = (attendance.data ?? []).find((a) => a.day_date === todayISO())

  const relationLabel = (r: PickupRelation): string =>
    r === 'father'
      ? t('children.relFather')
      : r === 'mother'
        ? t('children.relMother')
        : r === 'grandparent'
          ? t('children.relGrandparent')
          : r === 'driver'
            ? t('children.relDriver')
            : t('children.relOther')

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col items-center text-center gap-1">
          <Avatar name={child.full_name} size={72} />
          <div className="type-title">{child.full_name}</div>
          <div className="type-secondary text-muted">
            {[classRow?.name ?? t('children.noClass'), ageLabel(child.birth_date) ?? '', `#${child.public_code}`]
              .filter(Boolean)
              .join(' • ')}
          </div>
          <div className="type-badge text-muted">
            {child.photo_consent
              ? `📷 ${t('children.photoConsent')}`
              : `🚫 ${t('children.photoConsent')}`}
          </div>
          {attendance.data &&
            (todayRow?.status === 'absent' ? (
              <span className="type-badge rounded-full bg-bad-soft text-bad-text px-3 py-1 mt-1">
                {t('children.todayAbsent')}
              </span>
            ) : todayRow?.status === 'leave' ? (
              <span className="type-badge rounded-full bg-warn-soft text-warn-text px-3 py-1 mt-1">
                {t('children.todayLeave')}
              </span>
            ) : todayRow ? (
              <span className="type-badge rounded-full bg-ok-soft text-ok-text px-3 py-1 mt-1">
                {t('children.todayPresent')}
                {todayRow.picked_up_at
                  ? ` • ${t('children.todayPickedUp', { time: formatClock12(todayRow.picked_up_at) })}`
                  : todayRow.arrived_at
                    ? ` • ${formatClock12(todayRow.arrived_at)}`
                    : ''}
              </span>
            ) : (
              <span className="type-badge rounded-full bg-soft text-muted px-3 py-1 mt-1">
                {t('children.todayNotYet')}
              </span>
            ))}
        </div>
        <div className="mt-3">
          <Button
            variant="soft"
            size="sm"
            disabled={growthBusy}
            onClick={async () => {
              if (nursery.status !== 'ready') return
              setGrowthBusy(true)
              try {
                const [childPhotos, childReports] = await Promise.all([
                  child.photo_consent
                    ? reportsApi.listChildPhotos(child.id, 24)
                    : Promise.resolve([]),
                  reportsApi.listChildReports(child.id, 12),
                ])
                const moodText = (m: string | null): string =>
                  m === 'happy'
                    ? t('reports.moodHappy')
                    : m === 'calm'
                      ? t('reports.moodCalm')
                      : m === 'sad'
                        ? t('reports.moodSad')
                        : m === 'tired'
                          ? t('reports.moodTired')
                          : '—'
                const opened = openPrintDocument({
                  nurseryName: nursery.nursery.name,
                  logoUrl: nursery.nursery.logo_url,
                  brandColor: nursery.nursery.brand_color,
                  title: t('children.growthTitle', { name: child.full_name }),
                  sections: [
                    {
                      type: 'kv',
                      rows: [
                        { label: t('children.class'), value: classRow?.name ?? t('children.noClass') },
                        { label: t('children.growthCode'), value: '#' + child.public_code },
                        { label: t('children.growthPhotos'), value: String(childPhotos.length) },
                        { label: t('children.growthReports'), value: String(childReports.length) },
                      ],
                    },
                    ...(childPhotos.length > 0
                      ? [
                          {
                            type: 'images' as const,
                            urls: childPhotos
                              .map((ph) => ph.url)
                              .filter((u): u is string => Boolean(u)),
                          },
                        ]
                      : []),
                    ...(childReports.length > 0
                      ? [
                          {
                            type: 'table' as const,
                            head: [
                              t('children.growthDate'),
                              t('reports.mood'),
                              t('reports.nap'),
                              t('children.growthNote'),
                            ],
                            rows: childReports.map((r) => [
                              r.date,
                              moodText(r.mood),
                              r.nap_slept ? t('reports.quickSlept') : t('reports.quickNoSleep'),
                              (r.note ?? '') ||
                                (Array.isArray(r.activities)
                                  ? r.activities.join(', ')
                                  : (r.activities ?? '')),
                            ]),
                          },
                        ]
                      : []),
                  ],
                  footerNote: t('pub.poweredBy'),
                })
                if (!opened) showToast(t('common.errorGeneric'), 'error')
              } catch {
                showToast(t('common.errorGeneric'), 'error')
              } finally {
                setGrowthBusy(false)
              }
            }}
          >
            <BookOpen size={16} />
            {t('children.growthFile')}
          </Button>
        </div>
        {canManage && (
          <div className="flex gap-2 mt-3 flex-wrap">
            <Field label={t('children.class')}>
              <Select
                value={enrollment?.class_id ?? ''}
                onChange={async (e) => {
                  try {
                    await mutations.moveClass.mutateAsync({
                      childId: child.id,
                      classId: e.target.value || null,
                    })
                  } catch (err) {
                    showToast(
                      err instanceof Error && err.message === 'class_full'
                        ? t('children.classFull')
                        : t('common.errorGeneric'),
                      'error',
                    )
                  }
                }}
              >
                <option value="">{t('children.noClass')}</option>
                {(classes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={child.photo_consent}
                onChange={(e) =>
                  void mutations.update.mutateAsync({
                    childId: child.id,
                    patch: { photo_consent: e.target.checked },
                  })
                }
                className="w-5 h-5 accent-[var(--color-primary)]"
              />
              <span className="type-body">{t('children.photoConsent')}</span>
            </label>
            <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
              <Archive size={16} />
              {t('common.archive')}
            </Button>
          </div>
        )}
      </Card>

      {health && (health.allergies.length > 0 || health.emergency_notes) && (
        <Card className="border-e-4 border-bad-text">
          <div className="flex items-center gap-2 text-bad-text">
            <TriangleAlert size={18} />
            <span className="type-section">{t('children.allergyTitle')}</span>
          </div>
          <div className="flex flex-col gap-1 mt-2">
            {health.allergies.map((a, i) => (
              <p key={i} className="type-body">
                {a.name}
                {a.severity ? ` — ${a.severity}` : ''}
                {a.notes ? ` — ${a.notes}` : ''}
              </p>
            ))}
            {health.emergency_notes && (
              <p className="type-body">{health.emergency_notes}</p>
            )}
          </div>
        </Card>
      )}

      <ChipRow>
        <Chip active={tab === 'overview'} onClick={() => setTab('overview')}>
          {t('children.tabOverview')}
        </Chip>
        <Chip active={tab === 'health'} onClick={() => setTab('health')}>
          {t('children.tabHealth')}
        </Chip>
        <Chip active={tab === 'attendance'} onClick={() => setTab('attendance')}>
          {t('children.tabAttendance')}
        </Chip>
        {isOwner && (
          <Chip active={tab === 'payments'} onClick={() => setTab('payments')}>
            {t('children.tabPayments')}
          </Chip>
        )}
        <Chip active={tab === 'photos'} onClick={() => setTab('photos')}>
          {t('children.tabPhotos')}
        </Chip>
      </ChipRow>

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="type-section">{t('children.guardians')}</h2>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => setGuardianOpen(true)}>
                  <Plus size={16} />
                  {t('children.addGuardian')}
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {guardians.map((g) => (
                <Card key={g.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="type-body">
                      {g.full_name}
                      {g.is_payer && (
                        <span className="type-badge text-good-text"> • {t('children.isPayer')}</span>
                      )}
                    </div>
                    <div className="type-badge text-muted" dir="ltr">
                      {g.phone}
                    </div>
                  </div>
                  {canManage && guardians.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void mutations.removeGuardian.mutateAsync({
                          guardianId: g.id,
                          childId: child.id,
                        })
                      }
                      aria-label={t('common.delete')}
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="type-section">{t('children.pickupPersons')}</h2>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => setPickupOpen(true)}>
                  <Plus size={16} />
                  {t('children.addPickupPerson')}
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {pickupPersons.map((p) => (
                <Card key={p.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="type-body">{p.full_name}</div>
                    <div className="type-badge text-muted">
                      {relationLabel(p.relation)}
                      {p.phone ? ` — ${p.phone}` : ''}
                    </div>
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void mutations.deletePickup.mutateAsync(p.id)}
                      aria-label={t('common.delete')}
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          </section>

          <section>
            <h2 className="type-section mb-2">{t('children.portalLink')}</h2>
            <Card>
              <p className="type-badge text-muted mb-2">{t('children.portalLinkHint')}</p>
              {activeToken ? (
                <div className="flex items-center justify-between">
                  <span className="type-body text-good-text">
                    {t('children.linkActive')} —{' '}
                    {t('children.linkExpires', { date: activeToken.expires_at.slice(0, 10) })}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void portalApi.revokeToken(activeToken.id).then(() => tokens.refetch())}
                    >
                      {t('children.revokeLink')}
                    </Button>
                  )}
                </div>
              ) : canManage && payer ? (
                <Button
                  onClick={async () => {
                    const url = await portalApi.issueToken(
                      nursery.status === 'ready' ? nursery.nurseryId : '',
                      payer.id,
                      null,
                    )
                    setFreshLink(url)
                    void tokens.refetch()
                  }}
                >
                  <Link2 size={16} />
                  {t('children.issueLink')}
                </Button>
              ) : null}
              {freshLink && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={async () => {
                      await navigator.clipboard.writeText(freshLink)
                      showToast(t('common.copied'))
                    }}
                  >
                    {t('children.copyLink')}
                  </Button>
                  {payer && waLink(payer.phone) && (
                    <a
                      href={`${waLink(payer.phone)}?text=${encodeURIComponent(freshLink)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button size="sm" variant="soft">
                        {t('children.sendWhatsapp')}
                      </Button>
                    </a>
                  )}
                </div>
              )}
            </Card>
          </section>

          {isOwner && settings.data && (
            <p className="type-badge text-muted">
              {t('children.enrolledOn', { date: child.created_at.slice(0, 10) })}
            </p>
          )}
        </div>
      )}

      {tab === 'health' && (
        <HealthTab
          childId={child.id}
          health={health}
          medications={medications}
          canManage={canManage}
          mutations={mutations}
        />
      )}

      {tab === 'attendance' &&
        (attendance.isPending ? (
          <LoadingState />
        ) : (attendance.data ?? []).length === 0 ? (
          <p className="type-secondary text-muted">{t('attendance.noHistory')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(attendance.data ?? []).map((a, i) => (
              <Card key={i} className="flex items-center justify-between py-3">
                <span className="type-body">{a.day_date}</span>
                <span className="type-badge text-muted">
                  {a.status === 'present'
                    ? `${t('attendance.present')}${a.arrived_at ? ` ${formatClock12(a.arrived_at)}` : ''}${a.picked_up_at ? ` ← ${formatClock12(a.picked_up_at)}` : ''}`
                    : a.status === 'absent'
                      ? t('attendance.absent')
                      : a.status === 'leave'
                        ? t('attendance.leave')
                        : t('attendance.earlyLeave')}
                </span>
              </Card>
            ))}
          </div>
        ))}

      {tab === 'payments' && isOwner && <ChildPaymentsTab childId={child.id} />}

      {tab === 'photos' &&
        (photos.isPending ? (
          <LoadingState />
        ) : (photos.data ?? []).length === 0 ? (
          <p className="type-secondary text-muted">{t('reports.noPhotosYet')}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(photos.data ?? []).map((p) =>
              p.url ? (
                <img
                  key={p.id}
                  src={p.url}
                  alt={p.caption ?? ''}
                  className="w-full aspect-square object-cover rounded-2xl"
                  loading="lazy"
                />
              ) : (
                <div key={p.id} className="w-full aspect-square rounded-2xl bg-soft" />
              ),
            )}
          </div>
        ))}

      <GuardianSheet
        open={guardianOpen}
        onClose={() => setGuardianOpen(false)}
        onSubmit={async (input) => {
          await mutations.addGuardian.mutateAsync({ childId: child.id, input })
          setGuardianOpen(false)
        }}
      />
      <PickupSheet
        open={pickupOpen}
        onClose={() => setPickupOpen(false)}
        onSubmit={async (input) => {
          await mutations.savePickup.mutateAsync({ childId: child.id, input })
          setPickupOpen(false)
        }}
      />
      <DangerConfirmSheet
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={t('common.archive')}
        entityName={child.full_name}
        lines={[t('children.deleteConfirm', { name: child.full_name })]}
        mode="archive"
        confirmLabel={t('common.archive')}
        onConfirm={() => {
          void mutations.archive.mutateAsync(child.id).then(() => setArchiveOpen(false))
        }}
      />
    </div>
  )
}

function GuardianSheet({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: {
    full_name: string
    phone: string
    relation: string | null
    is_payer: boolean
  }) => Promise<void>
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [isPayer, setIsPayer] = useState(false)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('children.addGuardian')}
      footer={
        <Button
          full
          disabled={name.trim().length < 2 || phone.trim().length < 10}
          onClick={() =>
            void onSubmit({ full_name: name, phone, relation: null, is_payer: isPayer })
          }
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('children.guardianName')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('children.guardianPhone')}>
          <TextInput
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPayer}
            onChange={(e) => setIsPayer(e.target.checked)}
            className="w-5 h-5 accent-[var(--color-primary)]"
          />
          <span className="type-body">{t('children.isPayer')}</span>
        </label>
      </div>
    </Sheet>
  )
}

function PickupSheet({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (input: {
    full_name: string
    relation: PickupRelation
    phone: string | null
  }) => Promise<void>
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [relation, setRelation] = useState<PickupRelation>('other')
  const [phone, setPhone] = useState('')
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('children.addPickupPerson')}
      footer={
        <Button
          full
          disabled={name.trim().length < 2}
          onClick={() =>
            void onSubmit({
              full_name: name,
              relation,
              phone: phone.trim() || null,
            })
          }
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('children.pickupName')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('children.relation')}>
          <Select
            value={relation}
            onChange={(e) => setRelation(e.target.value as PickupRelation)}
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {r === 'father'
                  ? t('children.relFather')
                  : r === 'mother'
                    ? t('children.relMother')
                    : r === 'grandparent'
                      ? t('children.relGrandparent')
                      : r === 'driver'
                        ? t('children.relDriver')
                        : t('children.relOther')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.phone')}>
          <TextInput
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  )
}

function HealthTab({
  childId,
  health,
  medications,
  canManage,
  mutations,
}: {
  childId: string
  health: ChildHealthProfileRow | null
  medications: MedicationScheduleRow[]
  canManage: boolean
  mutations: ReturnType<typeof useChildMutations>
}) {
  const t = useT()
  const [bloodType, setBloodType] = useState('')
  const [allergies, setAllergies] = useState<AllergyEntry[]>([])
  const [chronic, setChronic] = useState('')
  const [doctorName, setDoctorName] = useState('')
  const [doctorPhone, setDoctorPhone] = useState('')
  const [emergency, setEmergency] = useState('')
  const [vaccinations, setVaccinations] = useState('')
  const [medName, setMedName] = useState('')
  const [medDose, setMedDose] = useState('')

  useEffect(() => {
    setBloodType(health?.blood_type ?? '')
    setAllergies(health?.allergies ?? [])
    setChronic(health?.chronic_conditions ?? '')
    setDoctorName(health?.doctor_name ?? '')
    setDoctorPhone(health?.doctor_phone ?? '')
    setEmergency(health?.emergency_notes ?? '')
    setVaccinations(health?.vaccinations_note ?? '')
  }, [health])

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('children.health.bloodType')}>
            <TextInput
              value={bloodType}
              onChange={(e) => setBloodType(e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label={t('children.health.doctorPhone')}>
            <TextInput
              dir="ltr"
              value={doctorPhone}
              onChange={(e) => setDoctorPhone(e.target.value)}
              disabled={!canManage}
            />
          </Field>
        </div>
        <Field label={t('children.health.doctorName')}>
          <TextInput
            value={doctorName}
            onChange={(e) => setDoctorName(e.target.value)}
            disabled={!canManage}
          />
        </Field>
        <Field label={t('children.health.allergies')}>
          <div className="flex flex-col gap-2">
            {allergies.map((a, i) => (
              <span key={i} className="flex gap-2">
                <TextInput
                  value={a.name}
                  onChange={(e) => {
                    const next = [...allergies]
                    next[i] = { ...next[i], name: e.target.value }
                    setAllergies(next)
                  }}
                  placeholder={t('children.health.allergyName')}
                  disabled={!canManage}
                />
                <TextInput
                  value={a.severity ?? ''}
                  onChange={(e) => {
                    const next = [...allergies]
                    next[i] = { ...next[i], severity: e.target.value }
                    setAllergies(next)
                  }}
                  placeholder={t('children.health.allergySeverity')}
                  disabled={!canManage}
                />
              </span>
            ))}
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAllergies([...allergies, { name: '' }])}
              >
                <Plus size={16} />
                {t('children.health.addAllergy')}
              </Button>
            )}
          </div>
        </Field>
        <Field label={t('children.health.chronic')}>
          <TextArea
            value={chronic}
            onChange={(e) => setChronic(e.target.value)}
            disabled={!canManage}
            rows={2}
          />
        </Field>
        <Field label={t('children.health.emergencyNotes')}>
          <TextArea
            value={emergency}
            onChange={(e) => setEmergency(e.target.value)}
            disabled={!canManage}
            rows={2}
          />
        </Field>
        <Field label={t('children.health.vaccinations')}>
          <TextArea
            value={vaccinations}
            onChange={(e) => setVaccinations(e.target.value)}
            disabled={!canManage}
            rows={2}
          />
        </Field>
        {canManage && (
          <Button
            onClick={() =>
              void mutations.saveHealth.mutateAsync({
                childId,
                profile: {
                  blood_type: bloodType || null,
                  allergies: allergies.filter((a) => a.name.trim()),
                  chronic_conditions: chronic || null,
                  doctor_name: doctorName || null,
                  doctor_phone: doctorPhone || null,
                  emergency_notes: emergency || null,
                  vaccinations_note: vaccinations || null,
                },
              })
            }
          >
            {t('common.save')}
          </Button>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <div className="type-section">{t('children.health.medications')}</div>
        {(medications ?? []).map((m) => (
          <div key={m.id} className="flex items-center justify-between">
            <span className="type-body">
              {m.medicine} — {m.dose}
              <span className="type-badge text-muted block">{m.times.join(' • ')}</span>
            </span>
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void mutations.deleteMedication.mutateAsync(m.id)}
                aria-label={t('common.delete')}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>
        ))}
        {canManage && (
          <div className="flex gap-2">
            <TextInput
              value={medName}
              onChange={(e) => setMedName(e.target.value)}
              placeholder={t('children.health.medicine')}
            />
            <TextInput
              value={medDose}
              onChange={(e) => setMedDose(e.target.value)}
              placeholder={t('children.health.dose')}
            />
            <Button
              size="sm"
              disabled={!medName.trim() || !medDose.trim()}
              onClick={async () => {
                await mutations.saveMedication.mutateAsync({
                  childId,
                  input: {
                    medicine: medName,
                    dose: medDose,
                    times: [],
                    guardian_note: null,
                  },
                })
                setMedName('')
                setMedDose('')
              }}
            >
              <Plus size={16} />
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
