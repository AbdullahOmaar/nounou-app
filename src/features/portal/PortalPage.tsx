import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react'
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
  formatMoney,
  shiftISODate,
  todayISO,
  waLink,
} from '../../lib/format'
import type { PaymentMethod } from '../../types/database'
import * as api from './api'
import { capturePortalToken, getStoredPortalToken } from './session'

/**
 * بوابة ولي الأمر العامة (/p/:token): بلا حساب وبلا تثبيت — الرابط
 * الموقّع وحده هو الهوية، وكل البيانات عبر RPCs محروسة بالتوكن.
 * المحتوى: يوم الطفل (وصول/استلام + تقرير منشور + صور بموافقة) +
 * كشف حساب + دفع بتحويل مع إثبات + إعلانات + كود الاستلام عند تفعيله.
 */
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

  const { nursery, guardian, children, announcements } = overview.data
  const viewOnly = overview.data.access_scope === 'view'
  const nurseryWa = waLink(nursery.phone)

  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="mx-auto max-w-[640px] px-4 pt-6 pb-10 flex flex-col gap-4">
        <header className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Mascot size={48} />
            <div>
              <div className="type-title">{nursery.name}</div>
              <div className="type-secondary text-muted">
                {t('portal.welcome', { name: guardian.full_name })}
              </div>
              {viewOnly && (
                <span className="type-badge bg-soft rounded-full px-2 py-0.5">
                  {t('portal.viewOnlyBadge')}
                </span>
              )}
            </div>
          </div>
          <span className="flex items-center gap-1">
            {!viewOnly && <MessagesButton token={token} />}
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
                <DaySection day={day.data} />
                <PhotosSection token={token!} photos={day.data.photos} />
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

        {announcements.length > 0 && (
          <section>
            <h2 className="type-section mb-2">{t('portal.announcementsTitle')}</h2>
            <div className="flex flex-col gap-2">
              {announcements.map((a) => (
                <Card key={a.id}>
                  <div className="type-body font-semibold">{a.title}</div>
                  <p className="type-secondary whitespace-pre-wrap">{a.body}</p>
                </Card>
              ))}
            </div>
          </section>
        )}

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

function DaySection({ day }: { day: api.PortalChildDay }) {
  const t = useT()
  const att = day.attendance
  const report = day.report
  const mealLabel = (m: string): string =>
    m === 'breakfast'
      ? t('reports.mealBreakfast')
      : m === 'snack'
        ? t('reports.mealSnack')
        : t('reports.mealLunch')
  const ateLabel = (a: string): string =>
    a === 'all'
      ? t('reports.ateAll')
      : a === 'most'
        ? t('reports.ateMost')
        : a === 'some'
          ? t('reports.ateSome')
          : t('reports.ateNone')
  const moodLabel = (m: string): string =>
    m === 'happy'
      ? t('reports.moodHappy')
      : m === 'calm'
        ? t('reports.moodCalm')
        : m === 'sad'
          ? t('reports.moodSad')
          : m === 'tired'
            ? t('reports.moodTired')
            : t('reports.moodSick')

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="type-body">
          {att?.arrived_at
            ? `${t('portal.arrived')} — ${formatClock12(att.arrived_at)}`
            : att?.status === 'absent'
              ? t('attendance.absent')
              : att?.status === 'leave'
                ? t('attendance.leave')
                : t('portal.notArrivedYet')}
        </span>
        <span className="type-badge text-muted">
          {att?.picked_up_at
            ? t('attendance.pickedUpBy', { name: att.picked_up_by_name ?? '' })
            : att?.arrived_at
              ? t('portal.notPickedUpYet')
              : ''}
        </span>
      </div>
      {report ? (
        <div className="border-t border-border pt-3 flex flex-col gap-2">
          <div className="type-section">{t('portal.reportTitle')}</div>
          {report.meals.length > 0 && (
            <div>
              <div className="type-badge text-muted">{t('portal.mealsTitle')}</div>
              {report.meals.map((m) => (
                <div key={m.meal} className="type-body flex justify-between">
                  <span>{mealLabel(m.meal)}</span>
                  <span>{ateLabel(m.ate)}</span>
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
              <span>{moodLabel(report.mood)}</span>
            </div>
          )}
          {report.note && <p className="type-secondary">{report.note}</p>}
        </div>
      ) : (
        <p className="type-secondary text-muted border-t border-border pt-3">
          {t('portal.reportNotYet')}
        </p>
      )}
    </Card>
  )
}

function PhotosSection({
  token,
  photos,
}: {
  token: string
  photos: api.PortalDayPhoto[]
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
              <img
                key={p.id}
                src={url}
                alt={p.caption ?? ''}
                className="w-full aspect-square object-cover rounded-xl"
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
                className="w-full aspect-square rounded-xl bg-soft text-muted type-secondary"
              >
                {t('portal.photoRetry')}
              </button>
            )
          }
          return <div key={p.id} className="w-full aspect-square rounded-xl bg-soft" />
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
