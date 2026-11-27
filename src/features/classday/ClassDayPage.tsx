import { Suspense, lazy, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Camera, Check, Clock, Home, QrCode, Undo2, X } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Field, TextInput } from '../../components/ui/form'
import { Sheet } from '../../components/ui/Sheet'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { formatClock12, fmtWeekdayDate, todayISO } from '../../lib/format'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useClasses } from '../classes/hooks'
import { enqueuePickupCode } from '../settings/whatsapp'
import { useNurserySettings } from '../settings/hooks'
import * as api from './api'
import { useAttendanceWriter, useClassDay, useDayChildren } from './hooks'
// ماسح QR يُحمَّل كسولاً عند أول فتح فقط (3A-335): مكتبة @zxing/browser
// كانت تضخّم حزمة شاشة اليوم (486KB) رغم أن المسح فعل اختياري نادر،
// فصارت حزمة منفصلة لا تصل الجهاز إلا عند ضغط زر المسح.
const QrScannerSheet = lazy(() =>
  import('./QrScannerSheet').then((m) => ({ default: m.QrScannerSheet })),
)

/**
 * «وضع الفصل»: شاشة اليوم التشغيلية — بلاطات كبيرة لكل طفل، وصول بلمسة
 * (أو مسح كارت)، غياب/إجازة، وتسليم من قايمة المصرح لهم فقط (+ كود
 * يومي عند تفعيله). الكتابة تمر بطابور الأوفلاين.
 */
export function ClassDayPage() {
  const t = useT()
  const { classId } = useParams()
  const navigate = useNavigate()
  const nursery = useCurrentNursery()
  const classes = useClasses()
  const className =
    classes.data?.find((c) => c.id === classId)?.name ?? ''
  const canAttend =
    nursery.status === 'ready' && nursery.can('can_take_attendance')
  const settings = useNurserySettings()
  const date = todayISO()
  const day = useClassDay(classId, date)
  const children = useDayChildren(classId, day.data?.id)
  const { write, queued, actorId, nurseryId } = useAttendanceWriter()
  const showToast = useToast()
  const [search, setSearch] = useState('')
  const [pickupChild, setPickupChild] = useState<api.DayChild | null>(null)
  const [pickupCode, setPickupCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [codeError, setCodeError] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const list = useMemo(() => {
    const q = search.trim()
    return (children.data ?? []).filter(
      (d) => !q || d.child.full_name.includes(q),
    )
  }, [children.data, search])

  const doneCount = (children.data ?? []).filter((d) => d.attendance).length
  const total = (children.data ?? []).length
  const codeEnabled = settings.data?.pickup_code_enabled ?? false

  async function ensureCodes() {
    if (!nurseryId || !codeEnabled) return
    const ids = (children.data ?? []).map((d) => d.child.id)
    // توليد أكواد اليوم فقط — التحقق صار خادمياً (420-U2)، لا أكواد تُقارن هنا
    await api.ensurePickupCodes(nurseryId, ids, date)
  }

  function basePayload(d: api.DayChild): api.AttendanceUpsert {
    return {
      nursery_id: nurseryId!,
      class_day_id: day.data!.id,
      child_id: d.child.id,
      status: d.attendance?.status ?? 'present',
      arrived_at: d.attendance?.arrived_at ?? null,
      arrived_by: d.attendance?.arrived_by ?? null,
      arrival_method: d.attendance?.arrival_method ?? null,
      picked_up_at: d.attendance?.picked_up_at ?? null,
      picked_up_by: d.attendance?.picked_up_by ?? null,
      picked_up_guardian: d.attendance?.picked_up_guardian ?? false,
      picked_up_guardian_id: d.attendance?.picked_up_guardian_id ?? null,
      handed_by: d.attendance?.handed_by ?? null,
      pickup_code_used: d.attendance?.pickup_code_used ?? false,
    }
  }

  function markArrived(d: api.DayChild, method: 'manual' | 'qr' = 'manual') {
    write.mutate({
      ...basePayload(d),
      status: 'present',
      arrived_at: new Date().toISOString(),
      arrived_by: actorId,
      arrival_method: method,
    })
  }

  function markStatus(d: api.DayChild, status: 'absent' | 'leave') {
    write.mutate({
      ...basePayload(d),
      status,
      arrived_at: null,
      picked_up_at: null,
      picked_up_by: null,
    })
  }

  function undoDay(d: api.DayChild) {
    write.mutate({
      ...basePayload(d),
      status: 'present',
      arrived_at: null,
      arrived_by: null,
      arrival_method: null,
      picked_up_at: null,
      picked_up_by: null,
      picked_up_guardian: false,
      picked_up_guardian_id: null,
      handed_by: null,
      pickup_code_used: false,
    })
  }

  async function handleScan(code: string) {
    setScannerOpen(false)
    if (!nurseryId) return
    const child = await api.findChildByCode(nurseryId, code.trim())
    if (!child) {
      showToast(t('attendance.qrUnknown'), 'error')
      return
    }
    const target = (children.data ?? []).find((d) => d.child.id === child.id)
    if (target) {
      markArrived(target, 'qr')
      showToast(t('attendance.qrChildArrived', { name: child.full_name }))
    } else {
      showToast(t('attendance.qrUnknown'), 'error')
    }
  }

  async function confirmPickup(
    personId: string | null,
    isGuardian: boolean,
    guardianId: string | null = null,
  ) {
    if (!pickupChild) return
    if (codeEnabled) {
      // 420-U2: تحقق خادمي ذرّي — الكود يُعلَّم مستخدماً وتُسجَّل المحاولات
      const verdict = await api.verifyPickupCode(
        nurseryId!,
        pickupChild.child.id,
        date,
        pickupCode,
      )
      if (!verdict.ok) {
        if (verdict.reason === 'error') {
          showToast(t('common.errorGeneric'), 'error')
        } else {
          setCodeError(true)
        }
        return
      }
    }
    write.mutate({
      ...basePayload(pickupChild),
      picked_up_at: new Date().toISOString(),
      picked_up_by: personId,
      picked_up_guardian: isGuardian,
      picked_up_guardian_id: guardianId,
      handed_by: actorId,
      pickup_code_used: codeEnabled,
    })
    setPickupChild(null)
    setPickupCode('')
    setCodeError(false)
  }

  if (day.isPending || children.isPending) return <LoadingState />
  if (day.isError || children.isError || !day.data)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void children.refetch()}
      />
    )

  return (
    <div className="flex flex-col gap-3">
      {/* هوية نونو — الموجة 1: ترويسة الفصل + شريحة التاريخ الكامل
          (يوم الأسبوع + التاريخ من إصلاح الإنتاج D1/D8 — مثبّت على القاهرة) */}
      <div className="flex items-center justify-between">
        <h1 className="type-title">{className}</h1>
        <span className="type-badge bg-soft text-primary rounded-full px-2.5 py-1">
          {fmtWeekdayDate(date)}
        </span>
      </div>

      <div className="relative flex-1">
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('attendance.searchPlaceholder')}
        />
      </div>

      {/* بطاقة تقدّم التسجيل: عنوان + عدّاد + شريط كهرماني + تلميح */}
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="type-section">{t('attendance.progressTitle')}</span>
          <span className="flex items-center gap-2">
            {queued > 0 && (
              <span className="type-badge text-bad-text bg-bad-soft rounded-full px-2 py-1">
                {t('attendance.syncPending', { count: queued })}
              </span>
            )}
            <span className="type-section text-accent-text">
              {t('attendance.progress', { done: doneCount, total })}
            </span>
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-soft overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: total ? `${(doneCount / total) * 100}%` : '0%' }}
          />
        </div>
        {total - doneCount > 0 && (
          <p className="type-secondary text-muted">
            {t('attendance.progressRemaining', { count: total - doneCount })}
          </p>
        )}
      </Card>

      {/* زر QR الكهرماني — الإجراء البارز في الشاشة */}
      <Button
        variant="accent"
        full
        onClick={() => setScannerOpen(true)}
        aria-label={t('attendance.scanQr')}
      >
        <QrCode size={20} />
        {t('attendance.scanQrCta')}
      </Button>

      {list.length === 0 ? (
        <EmptyState title={t('children.emptyTitle')} hint={t('children.emptyBody')} />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((d) => {
            const att = d.attendance
            const picked = Boolean(att?.picked_up_at)
            return (
              <Card key={d.child.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-center gap-2 min-h-[56px]">
                  <Avatar name={d.child.full_name} />
                  <div className="min-w-0">
                    <div className="type-body truncate">{d.child.full_name}</div>
                    <div className="type-badge text-muted">
                      {!att
                        ? t('attendance.notYetArrived')
                        : att.status === 'absent'
                          ? t('attendance.absent')
                          : att.status === 'leave'
                            ? t('attendance.leave')
                            : picked
                              ? t('attendance.pickedUpAt', {
                                  time: formatClock12(att.picked_up_at!),
                                })
                              : t('attendance.arrivedAt', {
                                  time: formatClock12(att.arrived_at ?? ''),
                                })}
                    </div>
                  </div>
                </div>
                {canAttend && !picked && (
                  <div className="flex gap-1.5">
                    {!att || att.status !== 'present' ? (
                      <>
                        <Button
                          className="flex-1"
                          onClick={() => markArrived(d)}
                        >
                          <Check size={16} />
                          {t('attendance.markArrived')}
                        </Button>
                        <Button
                          variant="soft"
                          onClick={() => markStatus(d, 'absent')}
                          aria-label={t('attendance.markAbsent')}
                        >
                          <X size={16} />
                          {t('attendance.markAbsent')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="soft"
                        className="flex-1"
                        onClick={() => {
                          void ensureCodes()
                          setPickupChild(d)
                        }}
                      >
                        <Home size={16} />
                        {t('attendance.pickUp')}
                      </Button>
                    )}
                    {att && (
                      <Button
                        variant="ghost"
                        onClick={() => undoDay(d)}
                        aria-label={t('attendance.undo')}
                      >
                        <Undo2 size={16} />
                      </Button>
                    )}
                  </div>
                )}
                {picked && (
                  <div className="flex items-center gap-1 type-badge text-good-text">
                    <Clock size={14} />
                    {t('attendance.pickedUp')}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {(() => {
        const picked = list.filter((d) => d.attendance?.picked_up_at)
        if (picked.length === 0) return null
        return (
          <Card className="flex flex-col gap-2">
            <h2 className="type-section">{t('attendance.pickupLogTitle')}</h2>
            {picked.map((d) => {
              const g = d.guardians.find(
                (x) => x.id === d.attendance?.picked_up_guardian_id,
              )
              const person = d.pickupPersons.find(
                (x) => x.id === d.attendance?.picked_up_by,
              )
              return (
                <div
                  key={d.child.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="type-body">{d.child.full_name}</span>
                  <span className="type-badge text-muted">
                    {(d.attendance?.picked_up_at ?? '').slice(11, 16)}
                    {' • '}
                    {g?.full_name ?? person?.full_name ?? ''}
                    {d.attendance?.pickup_code_used
                      ? ` • ${t('attendance.pickupLogCodeUsed')}`
                      : ''}
                  </span>
                </div>
              )
            })}
          </Card>
        )
      })()}

      {/* إقفال اليوم: زر واحد أسفل — إرسال تقارير اليوم (الخطوة التي
          تُقفِل اليوم فعلياً في المنتج؛ لا زر إغلاق وهمي بلا تنفيذ) */}
      {total > 0 && doneCount === total && (
        <Button full onClick={() => navigate('/reports')}>
          {t('attendance.sendReportsCta')}
        </Button>
      )}

      <Sheet
        open={Boolean(pickupChild)}
        onClose={() => setPickupChild(null)}
        title={
          pickupChild
            ? t('attendance.pickupSheetTitle', { name: pickupChild.child.full_name })
            : ''
        }
      >
        {pickupChild && (
          <div className="flex flex-col gap-3">
            <p className="type-secondary text-muted">{t('attendance.pickupSheetHint')}</p>
            {codeEnabled && (
              <Field label={t('attendance.pickupCodeLabel')}>
                <TextInput
                  dir="ltr"
                  inputMode="numeric"
                  value={pickupCode}
                  onChange={(e) => {
                    setPickupCode(e.target.value)
                    setCodeError(false)
                  }}
                  placeholder="------"
                />
                {codeError && (
                  <span className="type-badge text-bad-text">
                    {t('attendance.pickupCodeWrong')}
                  </span>
                )}
              </Field>
            )}
            {codeEnabled && nursery.status === 'ready' && nursery.isOwner && (
              <Button
                variant="ghost"
                disabled={sendingCode}
                onClick={async () => {
                  setSendingCode(true)
                  try {
                    const map = await api.ensurePickupCodes(
                      nurseryId!,
                      [pickupChild.child.id],
                      date,
                    )
                    const code = map.get(pickupChild.child.id)
                    if (!code) throw new Error('no_code')
                    const status = await enqueuePickupCode(
                      nurseryId!,
                      pickupChild.child.id,
                      code,
                    )
                    showToast(
                      status === 'queued'
                        ? t('attendance.codeQueued')
                        : t('attendance.codeBlocked'),
                    )
                  } catch {
                    showToast(t('common.errorGeneric'), 'error')
                  } finally {
                    setSendingCode(false)
                  }
                }}
              >
                {t('attendance.sendCodeWhatsapp')}
              </Button>
            )}
            {pickupChild.guardians.map((g) => (
              <Button
                key={g.id}
                variant="soft"
                className="justify-start"
                onClick={() => confirmPickup(null, true, g.id)}
              >
                {g.full_name}
                <span className="type-badge text-good-text">
                  {t('attendance.pickupGuardianBadge')}
                </span>
              </Button>
            ))}
            {pickupChild.pickupPersons.length === 0 && pickupChild.guardians.length === 0 ? (
              <p className="type-secondary text-bad-text">
                {t('attendance.noPickupPersons')}
              </p>
            ) : (
              pickupChild.pickupPersons.map((p) => (
                <Button
                  key={p.id}
                  variant="soft"
                  className="justify-start"
                  onClick={() => confirmPickup(p.id, false)}
                >
                  <Camera size={16} className="hidden" />
                  {p.full_name}
                  <span className="type-badge text-muted">
                    {p.relation === 'father'
                      ? t('children.relFather')
                      : p.relation === 'mother'
                        ? t('children.relMother')
                        : p.relation === 'grandparent'
                          ? t('children.relGrandparent')
                          : p.relation === 'driver'
                            ? t('children.relDriver')
                            : t('children.relOther')}
                  </span>
                </Button>
              ))
            )}
          </div>
        )}
      </Sheet>

      {scannerOpen && (
        <Suspense fallback={null}>
          <QrScannerSheet
            open
            onClose={() => setScannerOpen(false)}
            onCode={(code) => void handleScan(code)}
          />
        </Suspense>
      )}
    </div>
  )
}
