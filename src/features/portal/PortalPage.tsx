import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronLeft, ChevronRight, MessageCircle, MessageCircleQuestion, Send } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Sheet } from '../../components/ui/Sheet'
import { Chip, ChipRow, Field, TextArea, TextInput } from '../../components/ui/form'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Mascot } from '../../components/mascot/Mascot'
import { useT } from '../../i18n'
import { useLocale, setLocale } from '../../i18n/locale'
import { fmtPeriod } from '../../i18n/format'
import {
  formatClock12,
  formatDateTimeAr,
  formatMoney,
  shiftISODate,
  todayISO,
  waLink,
} from '../../lib/format'
import { useToast } from '../../components/ui/toast'
import type { PaymentMethod } from '../../types/database'
import * as api from './api'
import { capturePortalToken, getStoredPortalToken } from './session'

/**
 * بوابة ولي الأمر العامة (/p/:token): بلا حساب وبلا تثبيت — الرابط
 * الموقّع وحده هو الهوية، وكل البيانات عبر RPCs محروسة بالتوكن.
 * المحتوى: يوم الطفل (وصول/استلام + تقرير منشور + صور بموافقة) +
 * كشف حساب + دفع بتحويل مع إثبات + إعلانات + كود الاستلام عند تفعيله.
 */

// ترجمات أقسام التقرير — على مستوى الوحدة لتشاركها بطاقة اليوم
// (DaySection) وبطاقة نونا الصوتية وخط اليوم (PortalDayHero)
type TranslateFn = ReturnType<typeof useT>
function mealLabel(t: TranslateFn, m: string): string {
  return m === 'breakfast'
    ? t('reports.mealBreakfast')
    : m === 'snack'
      ? t('reports.mealSnack')
      : t('reports.mealLunch')
}
function ateLabel(t: TranslateFn, a: string): string {
  return a === 'all'
    ? t('reports.ateAll')
    : a === 'most'
      ? t('reports.ateMost')
      : a === 'some'
        ? t('reports.ateSome')
        : t('reports.ateNone')
}
function moodLabel(t: TranslateFn, m: string): string {
  return m === 'happy'
    ? t('reports.moodHappy')
    : m === 'calm'
      ? t('reports.moodCalm')
      : m === 'sad'
        ? t('reports.moodSad')
        : m === 'tired'
          ? t('reports.moodTired')
          : t('reports.moodSick')
}

export function PortalPage() {
  const t = useT()
  const locale = useLocale()
  const { token: urlToken } = useParams()
  // جلسة الجهاز (3A-375): أول فتح يلتقط التوكن ويخزنه وينظف شريط
  // العنوان؛ الزيارات اللاحقة بلا توكن تقرأ المخزن تلقائياً.
  const [sessionToken, setSessionToken] = useState<string | null>(() =>
    getStoredPortalToken(),
  )
  useEffect(() => {
    if (urlToken) setSessionToken(capturePortalToken(urlToken))
  }, [urlToken])
  const token = urlToken ?? sessionToken
  const [childId, setChildId] = useState<string | null>(null)
  const [date, setDate] = useState(todayISO())

  const overview = useQuery({
    queryKey: ['portal-overview', token],
    enabled: Boolean(token),
    queryFn: () => api.fetchPortalOverview(token!),
    retry: false,
  })

  const activeChild =
    overview.data?.children.find((c) => c.id === childId) ??
    overview.data?.children[0]

  const day = useQuery({
    queryKey: ['portal-day', token, activeChild?.id, date],
    enabled: Boolean(token && activeChild),
    queryFn: () => api.fetchPortalChildDay(token!, activeChild!.id, date),
    retry: false,
  })

  // بلا توكن في الرابط ولا جلسة مخزنة: ليست حالة تحميل — اطلب رابطاً
  // جديداً (قبل 375 كانت هذه الحالة عالق تحميل بلا نهاية).
  if (!token) {
    return (
      <div className="min-h-dvh bg-bg text-text flex items-center justify-center p-4">
        <Card className="text-center py-8 max-w-sm w-full">
          <div className="flex justify-center mb-3">
            <Mascot size={64} state="empty" />
          </div>
          <div className="type-section mb-1">{t('portal.invalidLink')}</div>
          <p className="type-secondary text-muted">{t('portal.invalidLinkBody')}</p>
        </Card>
      </div>
    )
  }

  if (overview.isPending) return <LoadingState />
  if (overview.isError || !overview.data) {
    return (
      <div className="min-h-dvh bg-bg text-text flex items-center justify-center p-4">
        <Card className="text-center py-8 max-w-sm w-full">
          <div className="flex justify-center mb-3">
            <Mascot size={64} state="empty" />
          </div>
          <div className="type-section mb-1">{t('portal.invalidLink')}</div>
          <p className="type-secondary text-muted">{t('portal.invalidLinkBody')}</p>
        </Card>
      </div>
    )
  }

  const { nursery, guardian, children } = overview.data
  const viewOnly = overview.data.access_scope === 'view'
  const nurseryWa = waLink(nursery.phone)

  return (
    <div className="min-h-dvh bg-bg text-text">
      {nursery.brand_color && (
        <div style={{ backgroundColor: nursery.brand_color }} className="h-1.5" />
      )}
      <div className="mx-auto max-w-[640px] px-4 pt-6 pb-10 flex flex-col gap-4">
        <header className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {nursery.logo_url ? (
              <img
                src={nursery.logo_url}
                alt=""
                className="w-12 h-12 rounded-2xl object-cover"
              />
            ) : (
              <Mascot size={48} />
            )}
            <div>
              <div className="type-section">{nursery.name}</div>
              {viewOnly && (
                <span className="type-badge bg-soft rounded-full px-2 py-0.5">
                  {t('portal.viewOnlyBadge')}
                </span>
              )}
            </div>
          </div>
          <span className="flex items-center gap-1">
            {!viewOnly && <MessagesButton token={token} />}
            <QaButton token={token} viewOnly={viewOnly} />
            <NotificationsBell
              token={token}
              childName={(id) =>
                children.find((c) => c.id === id)?.full_name ?? ''
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
            >
              {locale === 'ar' ? t('common.langEn') : t('common.langAr')}
            </Button>
          </span>
        </header>

        {/* هوية نونو — الموجة 1: ترويسة دافئة بنونا (قصّة نصفية) + ترحيب
            باسم الوصي + شريحة اسم الحضانة — عنصر نونا الوحيد في الصفحة */}
        <div className="bg-surface rounded-2xl p-4 flex items-center gap-4 shadow-card">
          <div className="flex-1 min-w-0">
            <h1 className="type-title mb-1">
              {t('portal.nounaGreeting', {
                name: guardian.full_name.split(' ')[0],
              })}
            </h1>
            <p className="type-secondary text-muted">
              {t('portal.nounaIntro', {
                name:
                  activeChild?.full_name.split(' ')[0] ??
                  children[0]?.full_name.split(' ')[0] ??
                  '',
              })}
            </p>
            <span className="inline-block mt-2 type-badge bg-soft text-primary rounded-full px-2.5 py-1">
              {nursery.name}
            </span>
          </div>
          <img
            src="/nouna/nouna-half.png"
            alt=""
            className="w-[86px] shrink-0 rounded-[20px] shadow-card select-none"
          />
        </div>

        {children.length > 1 && (
          <ChipRow>
            {children.map((c) => (
              <Chip
                key={c.id}
                active={activeChild?.id === c.id}
                onClick={() => setChildId(c.id)}
              >
                {c.full_name}
              </Chip>
            ))}
          </ChipRow>
        )}

        {activeChild && (
          <>
            <Card className="flex items-center justify-between py-3">
              <span className="type-body">{activeChild.full_name}</span>
              {activeChild.balance > 0 ? (
                <span className="type-badge text-bad-text bg-bad-soft rounded-full px-2 py-1">
                  {t('portal.balanceDue')}: {formatMoney(activeChild.balance)}
                </span>
              ) : (
                <span className="type-badge text-good-text">
                  {t('portal.allSettled')}
                </span>
              )}
            </Card>

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDate(shiftISODate(date, -1))}
                aria-label={t('portal.pickDate')}
              >
                <ChevronRight size={18} className={locale === 'en' ? 'rotate-180' : undefined} />
              </Button>
              <span className="type-section">
                {t('portal.dayTitle', { name: activeChild.full_name.split(' ')[0] })}
                {' — '}
                {date}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={date >= todayISO()}
                onClick={() => setDate(shiftISODate(date, 1))}
                aria-label={t('portal.pickDate')}
              >
                <ChevronLeft size={18} className={locale === 'en' ? 'rotate-180' : undefined} />
              </Button>
            </div>

            {day.isPending ? (
              <LoadingState />
            ) : day.isError || !day.data ? (
              <ErrorState
                message={t('common.errorGeneric')}
                onRetry={() => void day.refetch()}
              />
            ) : (
              <>
                <PortalDayHero
                  day={day.data}
                  childName={activeChild.full_name.split(' ')[0]}
                />
                <DaySection day={day.data} />
                <PhotosSection token={token!} photos={day.data.photos} watermark={nursery.name} />
                <StatementSection day={day.data} />
                {!viewOnly && (
                <PaySection
                  token={token!}
                  childId={activeChild.id}
                  balance={activeChild.balance}
                  proofs={day.data.proofs}
                  onSent={() => void day.refetch()}
                />
                )}
                {day.data.pickup_code && (
                  <Card className="text-center py-4">
                    <div className="type-secondary text-muted">
                      {t('portal.pickupCodeTitle')}
                    </div>
                    <div className="type-title tracking-[0.3em]" dir="ltr">
                      {day.data.pickup_code}
                    </div>
                    <div className="type-badge text-muted">
                      {t('portal.pickupCodeHint')}
                    </div>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        <CircularsSection token={token!} viewOnly={viewOnly} />

        <DataRightsSection token={token!} viewOnly={viewOnly} />
        <TrustSection token={token!} />

        {nurseryWa && (
          <a
            href={nurseryWa}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-full bg-good-soft text-good-text py-3 type-body font-semibold"
          >
            <MessageCircle size={18} />
            {t('portal.contactNursery')}
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * هوية نونو — الموجة 1 (DESIGN §6): بطل الاستلام الآمن + ملخص اليوم
 * بصوت نونا + خط اليوم. كل سطر من بيانات اليوم الحية فقط — بلا أي
 * وقت أو نشاط مختلق: الخطوات بلا بيانات تظهر «لسه» بنقطة مجوّفة.
 */
function PortalDayHero({
  day,
  childName,
}: {
  day: api.PortalChildDay
  childName: string
}) {
  const t = useT()
  const att = day.attendance
  const report = day.report

  // بطل الاستلام: أخضر عند الوصول، وهادئ قبل الوصول/الغياب/الإجازة
  const picked = Boolean(att?.picked_up_at)
  const arrived = Boolean(att?.arrived_at)
  const picker = att?.picked_up_by_name?.trim() ?? ''
  const heroTitle = arrived
    ? t('portal.heroArrived', { name: childName })
    : att?.status === 'absent'
      ? t('portal.heroAbsent', { name: childName })
      : att?.status === 'leave'
        ? t('portal.heroLeave', { name: childName })
        : t('portal.heroNotArrived', { name: childName })
  const heroSub = picked
    ? picker
      ? t('portal.heroPickedUp', {
          time: formatClock12(att!.picked_up_at!),
          person: picker,
        })
      : t('portal.heroPickedUpTime', {
          time: formatClock12(att!.picked_up_at!),
        })
    : arrived
      ? t('portal.heroStillHere', {
          time: formatClock12(att!.arrived_at!),
        })
      : att?.status === 'absent' || att?.status === 'leave'
        ? ''
        : t('portal.heroNotArrivedSub')

  // ملخص نونا الصوتي: ملاحظة المعلمة أولاً، وإلا سطور قصيرة من التقرير
  const voiceLines: string[] = []
  if (report?.note) {
    voiceLines.push(report.note)
  } else if (report) {
    if (report.mood)
      voiceLines.push(
        `${t('portal.moodTitle')}: ${moodLabel(t, report.mood)}`,
      )
    if (report.meals.length > 0)
      voiceLines.push(
        report.meals
          .map((m) => `${mealLabel(t, m.meal)}: ${ateLabel(t, m.ate)}`)
          .join(' • '),
      )
    if (report.nap_from || report.nap_to)
      voiceLines.push(
        t('portal.napLine', {
          from: report.nap_from?.slice(0, 5) ?? '',
          to: report.nap_to?.slice(0, 5) ?? '',
        }),
      )
    if (report.activities.length > 0)
      voiceLines.push(report.activities.join(' • '))
  }

  const breakfast = report?.meals.find((m) => m.meal === 'breakfast')
  const lunch = report?.meals.find((m) => m.meal === 'lunch')
  const steps: { title: string; detail: string; done: boolean }[] = [
    {
      title: t('portal.tlArrival'),
      detail: arrived
        ? formatClock12(att!.arrived_at!)
        : t('attendance.notYetArrived'),
      done: arrived,
    },
    {
      title: t('portal.tlBreakfast'),
      detail: breakfast ? ateLabel(t, breakfast.ate) : t('portal.tlNotYet'),
      done: Boolean(breakfast),
    },
    {
      title: t('portal.tlActivity'),
      detail:
        report && report.activities.length > 0
          ? report.activities.join(' • ')
          : t('portal.tlNotYet'),
      done: Boolean(report && report.activities.length > 0),
    },
    {
      title: t('portal.tlNap'),
      detail:
        report?.nap_from || report?.nap_to
          ? t('portal.napLine', {
              from: report.nap_from?.slice(0, 5) ?? '',
              to: report.nap_to?.slice(0, 5) ?? '',
            })
          : lunch
            ? ateLabel(t, lunch.ate)
            : t('portal.tlNotYet'),
      done: Boolean(report?.nap_from || report?.nap_to || lunch),
    },
    {
      title: t('portal.tlDeparture'),
      detail: picked
        ? formatClock12(att!.picked_up_at!)
        : t('portal.tlPending'),
      done: picked,
    },
  ]

  return (
    <>
      <div
        className={
          arrived
            ? 'bg-ok-text text-on-primary rounded-2xl p-4 shadow-card'
            : 'bg-soft text-text rounded-2xl p-4 shadow-card'
        }
      >
        <div className="type-title">{heroTitle}</div>
        {heroSub && (
          <p className="type-secondary opacity-85 mt-1">{heroSub}</p>
        )}
      </div>

      <Card className="border-s-4 border-accent">
        <div className="type-section text-accent-text mb-1">
          {t('portal.nounaVoiceTitle')}
        </div>
        {voiceLines.length > 0 ? (
          voiceLines.map((line, i) => (
            <p key={i} className="type-body mt-1">
              {line}
            </p>
          ))
        ) : (
          <p className="type-secondary text-muted">
            {t('portal.reportNotYet')}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="type-section">
          {t('portal.timelineTitle', { name: childName })}
        </h2>
        {steps.map((s) => (
          <div key={s.title} className="flex items-start gap-3">
            <span
              aria-hidden
              className={
                s.done
                  ? 'mt-1.5 w-3 h-3 shrink-0 rounded-full bg-accent'
                  : 'mt-1.5 w-3 h-3 shrink-0 rounded-full border-2 border-border-interactive'
              }
            />
            <div className="min-w-0">
              <div className="type-body">{s.title}</div>
              <div className="type-badge text-muted">{s.detail}</div>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

function DaySection({ day }: { day: api.PortalChildDay }) {
  const t = useT()
  const report = day.report

  return (
    <Card className="flex flex-col gap-3">
      {report ? (
        <div className="flex flex-col gap-2">
          <div className="type-section">{t('portal.reportTitle')}</div>
          {report.meals.length > 0 && (
            <div>
              <div className="type-badge text-muted">{t('portal.mealsTitle')}</div>
              {report.meals.map((m) => (
                <div key={m.meal} className="type-body flex justify-between">
                  <span>{mealLabel(t, m.meal)}</span>
                  <span>{ateLabel(t, m.ate)}</span>
                </div>
              ))}
            </div>
          )}
          {(report.nap_from || report.nap_to) && (
            <div className="type-body flex justify-between">
              <span>{t('portal.napTitle')}</span>
              <span>
                {t('portal.napLine', {
                  from: report.nap_from?.slice(0, 5) ?? '',
                  to: report.nap_to?.slice(0, 5) ?? '',
                })}
              </span>
            </div>
          )}
          {report.activities.length > 0 && (
            <div>
              <div className="type-badge text-muted">{t('portal.activitiesTitle')}</div>
              <div className="type-body">{report.activities.join(' • ')}</div>
            </div>
          )}
          {report.mood && (
            <div className="type-body flex justify-between">
              <span>{t('portal.moodTitle')}</span>
              <span>{moodLabel(t, report.mood)}</span>
            </div>
          )}
          {report.note && <p className="type-secondary">{report.note}</p>}
        </div>
      ) : (
        <p className="type-secondary text-muted">
          {t('portal.reportNotYet')}
        </p>
      )}
    </Card>
  )
}

function PhotosSection({
  token,
  photos,
  watermark,
}: {
  token: string
  photos: api.PortalDayPhoto[]
  watermark: string
}) {
  const t = useT()
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const retriedRef = useRef<Set<string>>(new Set())

  // 420-T1: جلب متوازٍ (لا متسلسل) — روابط الصور الموقّعة تعيش 15 دقيقة فقط
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        photos.map(async (p) => [p.id, await api.fetchPortalPhotoUrl(token, p.id)] as const),
      )
      if (cancelled) return
      const next = new Map<string, string>()
      for (const [id, url] of entries) if (url) next.set(id, url)
      setUrls(next)
    })()
    return () => {
      cancelled = true
    }
  }, [token, photos])

  // رابط انتهى (ولي الأمر رجع للصفحة بعد ربع ساعة): إعادة طلب رابط جديد
  // لنفس الصورة مرة واحدة تلقائياً، ثم زر إعادة محاولة صريح عند الفشل.
  async function refreshPhoto(id: string) {
    const url = await api.fetchPortalPhotoUrl(token, id)
    if (url) {
      setFailed((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setUrls((prev) => new Map(prev).set(id, url))
    } else {
      setFailed((prev) => new Set(prev).add(id))
    }
  }

  if (photos.length === 0) return null
  return (
    <section>
      <h2 className="type-section mb-2">{t('portal.photosTitle')}</h2>
      <div className="grid grid-cols-2 gap-2">
        {photos.map((p) => {
          const url = urls.get(p.id)
          if (url && !failed.has(p.id)) {
            return (
              <div key={p.id} className="relative overflow-hidden rounded-2xl">
                <img
                  src={url}
                  alt={p.caption ?? ''}
                  className="w-full aspect-square object-cover"
                  loading="lazy"
                  onError={() => {
                    if (!retriedRef.current.has(p.id)) {
                      retriedRef.current.add(p.id)
                      void refreshPhoto(p.id)
                    } else {
                      setFailed((prev) => new Set(prev).add(p.id))
                    }
                  }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <span
                    className="type-badge text-white opacity-40 select-none"
                    style={{
                      transform: 'rotate(-24deg)',
                      textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                    }}
                  >
                    {watermark}
                  </span>
                </div>
              </div>
            )
          }
          if (failed.has(p.id)) {
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  retriedRef.current.delete(p.id)
                  void refreshPhoto(p.id)
                }}
                className="w-full aspect-square rounded-2xl bg-soft text-muted type-secondary"
              >
                {t('portal.photoRetry')}
              </button>
            )
          }
          return <div key={p.id} className="w-full aspect-square rounded-2xl bg-soft" />
        })}
      </div>
    </section>
  )
}

function StatementSection({ day }: { day: api.PortalChildDay }) {
  const t = useT()
  if (day.invoices.length === 0)
    return (
      <Card>
        <div className="type-section mb-1">{t('portal.statementTitle')}</div>
        <p className="type-secondary text-muted">{t('portal.noInvoices')}</p>
      </Card>
    )
  return (
    <Card>
      <div className="type-section mb-2">{t('portal.statementTitle')}</div>
      <div className="flex flex-col divide-y divide-border">
        {day.invoices.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between py-2">
            <span className="type-body">{fmtPeriod(inv.period)}</span>
            <span className="type-badge text-muted">
              {formatMoney(inv.paid)} / {formatMoney(inv.total)}
            </span>
            {inv.balance > 0 ? (
              <span className="type-badge text-bad-text">
                {formatMoney(inv.balance)}
              </span>
            ) : (
              <span className="type-badge text-good-text">{t('invoices.settled')}</span>
            )}
          </div>
        ))}
      </div>
      {(day.payments ?? []).length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          <div className="type-badge text-muted">{t('portal.receiptsTitle')}</div>
          {(day.payments ?? []).map((pay) => (
            <div key={pay.id} className="flex items-center justify-between">
              <span className="type-secondary">
                {pay.receipt_no
                  ? t('invoices.receiptNo', { no: pay.receipt_no })
                  : ''}
              </span>
              <span className="type-secondary text-muted">
                {formatMoney(pay.amount)} • {pay.paid_at.slice(0, 10)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function PaySection({
  token,
  childId,
  balance,
  proofs,
  onSent,
}: {
  token: string
  childId: string
  balance: number
  proofs: api.PortalChildDay['proofs']
  onSent: () => void
}) {
  const t = useT()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'cash'>>('instapay')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pending = proofs.find((p) => p.proof_status === 'pending')
  const rejected = proofs.find((p) => p.proof_status === 'rejected')

  async function handleSubmit() {
    setError(null)
    const value = parseFloat(amount)
    if (!value || value <= 0 || !file) {
      setError(t('common.errorGeneric'))
      return
    }
    setBusy(true)
    try {
      await api.submitPortalPayment(token, childId, value, method, file)
      setSent(true)
      setFile(null)
      setAmount('')
      onSent()
    } catch {
      setError(t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  if (balance <= 0 && !pending && !rejected) return null

  return (
    <Card className="flex flex-col gap-3">
      <div className="type-section">{t('portal.payTitle')}</div>
      {pending && (
        <p className="type-secondary text-good-text bg-good-soft rounded-xl px-3 py-2">
          {t('portal.payPending')} — {formatMoney(pending.amount)}
        </p>
      )}
      {rejected && (
        <p className="type-secondary text-bad-text bg-bad-soft rounded-xl px-3 py-2">
          {t('portal.payRejected', { reason: rejected.rejection_reason ?? '' })}
        </p>
      )}
      {sent && (
        <p className="type-secondary text-good-text bg-good-soft rounded-xl px-3 py-2">
          {t('portal.paySent')}
        </p>
      )}
      <p className="type-badge text-muted">{t('portal.payHint')}</p>
      <Field label={t('portal.payAmount')}>
        <TextInput
          type="number"
          inputMode="decimal"
          value={amount}
          placeholder={balance > 0 ? String(balance) : ''}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label={t('portal.payMethod')}>
        <ChipRow>
          <Chip active={method === 'instapay'} onClick={() => setMethod('instapay')}>
            {t('invoices.methodInstapay')}
          </Chip>
          <Chip
            active={method === 'vodafone_cash'}
            onClick={() => setMethod('vodafone_cash')}
          >
            {t('invoices.methodVodafone')}
          </Chip>
          <Chip
            active={method === 'bank_transfer'}
            onClick={() => setMethod('bank_transfer')}
          >
            {t('invoices.methodBank')}
          </Chip>
        </ChipRow>
      </Field>
      <Field label={t('invoices.proofRequired')}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="type-secondary"
        />
      </Field>
      {error && <p className="type-secondary text-bad-text">{error}</p>}
      <Button onClick={handleSubmit} disabled={busy || !file} full>
        {t('portal.paySubmit')}
      </Button>
    </Card>
  )
}

/** جرس إشعارات الوصيّ (2.1): شارة غير المقروء + قائمة تُعلَّم مقروءة عند الفتح */
function NotificationsBell({
  token,
  childName,
}: {
  token: string
  childName: (id: string | null) => string
}) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const inbox = useQuery({
    queryKey: ['portal-notifications', token],
    queryFn: () => api.fetchPortalNotifications(token),
    retry: false,
  })
  const unread = inbox.data?.unread ?? 0
  const markRead = useMutation({
    mutationFn: () => api.markPortalNotificationsRead(token),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['portal-notifications', token] }),
  })
  const text = (n: api.PortalNotification): string => {
    const name = childName(n.child_id)
    switch (n.kind) {
      case 'report':
        return t('portal.notif.report', { name })
      case 'proof_approved':
        return t('portal.notif.proofApproved', {
          amount: formatMoney(Number(n.meta.amount ?? 0)),
        })
      case 'proof_rejected':
        return t('portal.notif.proofRejected', {
          amount: formatMoney(Number(n.meta.amount ?? 0)),
        })
      case 'invoice':
        return t('portal.notif.invoice', {
          name,
          period: String(n.meta.period ?? ''),
        })
      case 'qa':
        return t('portal.notif.qa', {
          title: String(n.meta?.title ?? ''),
        })
      case 'message':
        return t('portal.notif.message')
      case 'announcement':
        return t('portal.notif.announcement', {
          title: String(n.meta.title ?? ''),
        })
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('portal.notif.title')}
        onClick={() => {
          setOpen(true)
          if (unread > 0) markRead.mutate()
        }}
      >
        <span className="relative inline-flex">
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute -top-1.5 -end-1.5 min-w-4 h-4 px-0.5 rounded-full bg-bad text-white type-badge flex items-center justify-center">
              {unread}
            </span>
          )}
        </span>
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('portal.notif.title')}>
        {(inbox.data?.items ?? []).length === 0 ? (
          <p className="type-secondary text-muted">{t('portal.notif.empty')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {(inbox.data?.items ?? []).map((n) => (
              <div key={n.id} className="py-2.5 flex flex-col gap-0.5">
                <span className="type-body">{text(n)}</span>
                <span className="type-badge text-muted">
                  {n.created_at.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </>
  )
}


/** رسائل الحضانة داخل البوابة (2.5): خيط الوصيّ + كتابة رسالة */
interface QaButtonProps {
  token: string
  viewOnly: boolean
}

function QaButton({ token, viewOnly }: QaButtonProps) {
  const t = useT()
  const showToast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map())
  const qa = useQuery({
    queryKey: ['portal-qa', token],
    queryFn: () => api.fetchPortalQa(token),
    enabled: open,
  })
  const ask = useMutation({
    mutationFn: (v: { sessionId: string; body: string }) =>
      api.askPortalQuestion(token, v.sessionId, v.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['portal-qa', token] })
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const sessions = qa.data ?? []
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t('portal.qaTitle')}
        onClick={() => setOpen(true)}
      >
        <MessageCircleQuestion size={20} />
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('portal.qaTitle')}>
        {qa.isLoading ? (
          <LoadingState />
        ) : sessions.length === 0 ? (
          <div className="type-secondary text-muted">{t('portal.qaEmpty')}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {sessions.map((s) => (
              <div key={s.id} className="flex flex-col gap-2">
                <div className="type-body">{s.title}</div>
                <div className="type-badge text-muted">
                  {formatDateTimeAr(s.starts_at)}
                  {s.status === 'live' ? ` • ${t('portal.qaLive')}` : ''}
                </div>
                {s.published.map((q) => (
                  <div key={q.id} className="bg-soft rounded-xl p-2">
                    <div className="type-secondary">{q.body}</div>
                    <div className="type-secondary mt-1">{q.answer}</div>
                  </div>
                ))}
                {s.mine
                  .filter((q) => !q.answer)
                  .map((q) => (
                    <div key={q.id} className="type-badge text-muted">
                      {q.body} — {t('portal.qaWaiting')}
                    </div>
                  ))}
                {!viewOnly && (
                  <div className="flex gap-2 items-start">
                    <TextArea
                      rows={2}
                      value={drafts.get(s.id) ?? ''}
                      placeholder={t('portal.qaPlaceholder')}
                      onChange={(e) =>
                        setDrafts((prev) => new Map(prev).set(s.id, e.target.value))
                      }
                    />
                    <Button
                      size="sm"
                      disabled={!(drafts.get(s.id) ?? '').trim() || ask.isPending}
                      onClick={() =>
                        ask.mutate({
                          sessionId: s.id,
                          body: (drafts.get(s.id) ?? '').trim(),
                        })
                      }
                    >
                      <Send size={16} />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </>
  )
}

interface MessagesButtonProps {
  token: string
}

function MessagesButton({ token }: MessagesButtonProps) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const thread = useQuery({
    queryKey: ['portal-messages', token],
    queryFn: () => api.fetchPortalMessages(token),
    enabled: open,
    retry: false,
  })
  const send = useMutation({
    mutationFn: () => api.sendPortalMessage(token, draft),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['portal-messages', token] })
    },
  })
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('portal.messagesTitle')}
        onClick={() => setOpen(true)}
      >
        <MessageCircle size={20} />
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('portal.messagesTitle')}
      >
        <div className="flex flex-col gap-2">
          {(thread.data ?? []).length === 0 && (
            <p className="type-secondary text-muted">{t('portal.messagesEmpty')}</p>
          )}
          {(thread.data ?? []).map((m) => (
            <div
              key={m.id}
              className={
                m.sender === 'guardian'
                  ? 'self-start max-w-[85%]'
                  : 'self-end max-w-[85%]'
              }
            >
              <Card className={m.sender === 'guardian' ? 'py-2 bg-primary-soft' : 'py-2 bg-soft'}>
                <p className="type-body whitespace-pre-wrap">{m.body}</p>
                <span className="type-badge text-muted">
                  {m.created_at.slice(0, 16).replace('T', ' ')}
                </span>
              </Card>
            </div>
          ))}
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('portal.messagesPlaceholder')}
            rows={3}
          />
          <Button disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}>
            {t('portal.messagesSend')}
          </Button>
        </div>
      </Sheet>
    </>
  )
}


function CircularsSection({
  token,
  viewOnly,
}: {
  token: string
  viewOnly: boolean
}) {
  const t = useT()
  const qc = useQueryClient()
  const circulars = useQuery({
    queryKey: ['portal-circulars', token],
    queryFn: () => api.fetchCirculars(token),
  })
  const markedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const c of circulars.data ?? []) {
      if (!c.read && !markedRef.current.has(c.id)) {
        markedRef.current.add(c.id)
        void api.markCircularRead(token, c.id)
      }
    }
  }, [circulars.data, token])
  const rsvp = useMutation({
    mutationFn: (args: { id: string; attending: boolean; guests: number }) =>
      api.circularRsvp(token, args.id, args.attending, args.guests),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['portal-circulars', token] }),
  })
  const items = circulars.data ?? []
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="type-section mb-2">{t('portal.announcementsTitle')}</h2>
      <div className="flex flex-col gap-2">
        {items.map((a) => (
          <Card key={a.id}>
            <div className="type-body font-semibold">{a.title}</div>
            <p className="type-secondary whitespace-pre-wrap">{a.body}</p>
            {a.wants_rsvp && !viewOnly && (
              <div className="flex items-center gap-2 mt-2">
                <Button
                  onClick={() =>
                    rsvp.mutate({
                      id: a.id,
                      attending: true,
                      guests: a.my_rsvp?.guests ?? 0,
                    })
                  }
                >
                  {t('portal.rsvpYes')}
                </Button>
                <Button
                  onClick={() =>
                    rsvp.mutate({ id: a.id, attending: false, guests: 0 })
                  }
                >
                  {t('portal.rsvpNo')}
                </Button>
                {a.my_rsvp?.attending && (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="-"
                      onClick={() =>
                        rsvp.mutate({
                          id: a.id,
                          attending: true,
                          guests: Math.max(0, (a.my_rsvp?.guests ?? 0) - 1),
                        })
                      }
                    >
                      −
                    </button>
                    <span className="type-secondary">
                      {t('portal.rsvpGuests', { count: a.my_rsvp.guests })}
                    </span>
                    <button
                      type="button"
                      aria-label="+"
                      onClick={() =>
                        rsvp.mutate({
                          id: a.id,
                          attending: true,
                          guests: Math.min(20, (a.my_rsvp?.guests ?? 0) + 1),
                        })
                      }
                    >
                      +
                    </button>
                  </span>
                )}
              </div>
            )}
            {a.my_rsvp && (
              <div className="type-badge text-muted mt-1">
                {a.my_rsvp.attending
                  ? t('portal.rsvpDoneYes')
                  : t('portal.rsvpDoneNo')}
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  )
}



function TrustSection({ token }: { token: string }) {
  const t = useT()
  const views = useQuery({
    queryKey: ['portal-photo-views', token],
    queryFn: () => api.fetchPhotoViews(token),
  })
  const rows = views.data ?? []
  return (
    <section className="space-y-2">
      <Card className="space-y-1">
        <p className="font-bold">{t('portal.trustTitle')}</p>
        <p className="text-sm text-muted">{t('portal.trustLine1')}</p>
        <p className="text-sm text-muted">{t('portal.trustLine2')}</p>
        <p className="text-sm text-muted">{t('portal.trustLine3')}</p>
      </Card>
      {rows.length > 0 && (
        <Card className="space-y-1">
          <p className="font-bold">{t('portal.viewsTitle')}</p>
          {rows.slice(0, 10).map((v, i) => (
            <p key={i} className="text-sm text-muted">
              {v.child_name} — {v.is_self
                ? t('portal.viewSelf')
                : v.viewer_kind === 'staff'
                  ? t('portal.viewStaff')
                  : t('portal.viewGuardian')} — {formatDateTimeAr(v.created_at)}
            </p>
          ))}
        </Card>
      )}
    </section>
  )
}

function DataRightsSection({
  token,
  viewOnly,
}: {
  token: string
  viewOnly: boolean
}) {
  const t = useT()
  const qc = useQueryClient()
  const showToast = useToast()
  const mine = useQuery({
    queryKey: ['portal-data-requests', token],
    queryFn: () => api.fetchMyDataRequests(token),
  })
  const create = useMutation({
    mutationFn: (kind: 'export' | 'deletion') => api.createDataRequest(token, kind),
    onSuccess: (status) => {
      if (status === 'ok') {
        showToast(t('portal.dataRequestSent'))
        void qc.invalidateQueries({ queryKey: ['portal-data-requests', token] })
      } else {
        showToast(t('common.errorGeneric'), 'error')
      }
    },
    onError: () => showToast(t('common.errorGeneric'), 'error'),
  })
  const statusLabel = (s: string): string =>
    s === 'done'
      ? t('portal.dataStatusDone')
      : s === 'rejected'
        ? t('portal.dataStatusRejected')
        : t('portal.dataStatusPending')
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="type-section">{t('portal.dataRightsTitle')}</h2>
      <p className="type-secondary text-muted">{t('portal.dataRightsBody')}</p>
      {(mine.data ?? []).map((r, i) => (
        <p key={i} className="type-secondary">
          {r.kind === 'export' ? t('portal.dataExport') : t('portal.dataDeletion')}
          {' — '}
          {statusLabel(r.status)}
        </p>
      ))}
      {!viewOnly && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="soft"
            disabled={create.isPending}
            onClick={() => create.mutate('export')}
          >
            {t('portal.dataExportBtn')}
          </Button>
          <Button
            size="sm"
            variant="soft"
            disabled={create.isPending}
            onClick={() => create.mutate('deletion')}
          >
            {t('portal.dataDeletionBtn')}
          </Button>
        </div>
      )}
    </Card>
  )
}
