import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Copy, MessageCircle, OctagonX } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Fab } from '../../components/ui/Fab'
import { ListRow } from '../../components/ui/ListRow'
import { Sheet } from '../../components/ui/Sheet'
import { Field, FormError, TextInput } from '../../components/ui/form'
import { useToast } from '../../components/ui/toast'
import { useT } from '../../i18n'
import { useLocale } from '../../i18n/locale'
import { fmtPeriod } from '../../i18n/format'
import { currentPeriod, formatMoney, todayISO, waLinkWithText } from '../../lib/format'
import { useNurserySettings } from '../settings/hooks'
import { useInvoices, useInvoiceMutations, useOverdue } from './hooks'
import { runFeeReminders } from './reminders'
import { makeStopFlag, type StopFlag } from '../../lib/bulk'
import { useAuth } from '../../lib/AuthProvider'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'

/**
 * الفواتير (للمالك فقط — المشرفات لا يصلن هنا أصلاً بحكم RLS فتظهر لهن
 * حالة فارغة): قائمة الشهر + إصدار جماعي + قسم المتأخرات برسائل جاهزة.
 */
export function InvoicesPage() {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const showToast = useToast()
  const [period, setPeriod] = useState(currentPeriod())
  const invoices = useInvoices(period)
  const overdue = useOverdue()
  const [reminding, setReminding] = useState(false)
  const remindStopRef = useRef<StopFlag>(makeStopFlag())
  const issueStopRef = useRef<StopFlag>(makeStopFlag())
  const { user } = useAuth()
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const settings = useNurserySettings()
  const mutations = useInvoiceMutations()
  const [issueOpen, setIssueOpen] = useState(false)
  const [paidOpen, setPaidOpen] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issueResult, setIssueResult] = useState<string | null>(null)

  // عيب 4 (فرق 100 ج): «المتبقي» = مجموع الأرصدة الموجبة فقط — نفس
  // تعريف الرئيسية (child_balances > 0) — والزيادة المدفوعة سطر مستقل
  // بدل ما تُخصم خفيةً من المتبقي (مريم دفعت 900 مقابل فاتورة 800).
  const totals = useMemo(() => {
    const list = (invoices.data ?? []).filter((i) => i.status !== 'cancelled')
    return {
      total: list.reduce((s, i) => s + i.total, 0),
      paid: list.reduce((s, i) => s + i.paid, 0),
      balance: list.reduce((s, i) => s + Math.max(i.balance, 0), 0),
      overpaid: list.reduce((s, i) => s + Math.max(-i.balance, 0), 0),
    }
  }, [invoices.data])

  // مجموعات الهوية (الموجة 4): متأخرة (رصيد قائم واستحقاقه فات) ثم
  // مستحقة ثم مدفوعة (مطوية افتراضيًا — قرار التصميم §5) ثم ملغاة.
  // التجميع من نفس الحقول المعروضة (balance/due_date/status) — المبالغ
  // والشارات كما هي حرفيًا.
  const groups = useMemo(() => {
    const list = invoices.data ?? []
    const today = todayISO()
    const isOverdue = (i: (typeof list)[number]) =>
      i.balance > 0 && i.due_date !== null && i.due_date < today
    return [
      {
        key: 'overdue',
        label: t('invoices.groupOverdue'),
        items: list.filter((i) => i.status !== 'cancelled' && isOverdue(i)),
      },
      {
        key: 'due',
        label: t('invoices.groupDue'),
        items: list.filter((i) => i.status !== 'cancelled' && i.balance > 0 && !isOverdue(i)),
      },
      {
        key: 'paid',
        label: t('invoices.groupPaid'),
        items: list.filter((i) => i.status !== 'cancelled' && i.balance <= 0),
      },
      {
        key: 'cancelled',
        label: t('invoices.statusCancelled'),
        items: list.filter((i) => i.status === 'cancelled'),
      },
    ].filter((g) => g.items.length > 0)
  }, [invoices.data, t])

  function invoiceRow(inv: NonNullable<typeof invoices.data>[number]) {
    return (
      <button
        key={inv.id}
        type="button"
        className="text-start cursor-pointer bg-transparent border-0 p-0 w-full"
        onClick={() => navigate(`/invoices/${inv.id}`)}
      >
        <ListRow
          leading={<Avatar name={inv.childName} />}
          title={inv.childName}
          secondary={`${t('invoices.total')} ${formatMoney(inv.total)}`}
          trailing={
            inv.status === 'cancelled' ? (
              <span className="type-badge text-muted">{t('invoices.statusCancelled')}</span>
            ) : inv.balance < 0 ? (
              <span className="type-badge text-ok-text bg-ok-soft rounded-full px-2 py-1">
                {t('invoices.overpaidBadge', { amount: formatMoney(-inv.balance) })}
              </span>
            ) : inv.balance === 0 ? (
              <span className="type-badge text-ok-text">{t('invoices.settled')}</span>
            ) : (
              <span className="type-badge text-bad-text bg-bad-soft rounded-full px-2 py-1">
                {formatMoney(inv.balance)}
              </span>
            )
          }
        />
      </button>
    )
  }

  function shiftPeriod(p: string, delta: number): string {
    const [y, m] = p.split('-').map((x) => parseInt(x, 10))
    const d = new Date(y, (m - 1) + delta, 1)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  }

  async function handleIssue() {
    setIssueError(null)
    try {
      issueStopRef.current = makeStopFlag()
      const res = await mutations.issue.mutateAsync({
        period,
        dueDate: dueDate || null,
        shouldStop: issueStopRef.current.shouldStop,
      })
      setIssueResult(
        `${t('invoices.issueDone', { count: res.issued })}${res.skipped ? ` — ${t('invoices.issueSkipped', { count: res.skipped })}` : ''}${
          res.noPrice.length > 0
            ? ` — ${t('invoices.issueNoPrice', { count: res.noPrice.length, names: res.noPrice.join(', ') })}`
            : ''
        }${
          res.stopped
            ? ` — ${t('common.bulkStopped', { done: res.issued, total: res.planned })}`
            : ''
        }`,
      )
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : t('common.errorGeneric'))
    }
  }

  function reminderText(item: NonNullable<typeof overdue.data>[number]): string {
    const template = settings.data?.reminder_template ?? ''
    return template
      .replaceAll('{guardian}', item.guardianName ?? '')
      .replaceAll('{name}', item.childName)
      .replaceAll('{period}', item.oldestPeriod)
      .replaceAll('{balance}', formatMoney(item.balance))
      .replaceAll('{paid}', '')
      .replaceAll('{total}', '')
  }

  async function copyOverdue() {
    const lines = (overdue.data ?? []).map(
      (o) => `${o.childName} — ${formatMoney(o.balance)}`,
    )
    await navigator.clipboard.writeText(lines.join('\n'))
    showToast(t('invoices.overdueCopied'))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          variant="soft"
          size="sm"
          aria-label={t('invoices.prevMonth')}
          onClick={() => setPeriod(shiftPeriod(period, -1))}
        >
          <ChevronRight size={18} className={locale === 'ar' ? undefined : 'rotate-180'} />
        </Button>
        <span className="type-section whitespace-nowrap">{fmtPeriod(period)}</span>
        <Button
          variant="soft"
          size="sm"
          aria-label={t('invoices.nextMonth')}
          onClick={() => setPeriod(shiftPeriod(period, 1))}
        >
          <ChevronLeft size={18} className={locale === 'ar' ? undefined : 'rotate-180'} />
        </Button>
      </div>

      <Card className="flex flex-col gap-3">
        <div>
          <div className="type-badge text-muted">{t('invoices.collected')}</div>
          <div className="type-title">{formatMoney(totals.paid)}</div>
        </div>
        <div className="flex gap-2 text-center">
          <div className="flex-1 bg-soft rounded-xl py-2">
            <div className="type-badge text-muted">{t('invoices.total')}</div>
            <div className="type-section">{formatMoney(totals.total)}</div>
          </div>
          <div className="flex-1 bg-soft rounded-xl py-2">
            <div className="type-badge text-muted">{t('invoices.balance')}</div>
            <div className="type-section text-bad-text">{formatMoney(totals.balance)}</div>
          </div>
          {totals.overpaid > 0 && (
            <div className="flex-1 bg-soft rounded-xl py-2">
              <div className="type-badge text-muted">{t('invoices.overpaid')}</div>
              <div className="type-section text-ok-text">{formatMoney(totals.overpaid)}</div>
            </div>
          )}
        </div>
      </Card>

      {invoices.isPending ? (
        <LoadingState />
      ) : invoices.isError ? (
        <ErrorState
          message={t('common.errorGeneric')}
          onRetry={() => void invoices.refetch()}
        />
      ) : (invoices.data ?? []).length === 0 ? (
        <EmptyState title={t('invoices.emptyTitle')} hint={t('invoices.emptyBody')} />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key}>
              {g.key === 'paid' ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-between mb-2 cursor-pointer bg-transparent border-0 p-0"
                  onClick={() => setPaidOpen((v) => !v)}
                  aria-expanded={paidOpen}
                >
                  <span className="type-section">{g.label}</span>
                  <span className="flex items-center gap-1 type-badge text-muted">
                    {g.items.length}
                    <ChevronDown size={16} className={paidOpen ? 'rotate-180' : undefined} />
                  </span>
                </button>
              ) : (
                <div className="flex items-center justify-between mb-2">
                  <h2 className="type-section">{g.label}</h2>
                  <span className="type-badge text-muted">{g.items.length}</span>
                </div>
              )}
              {(g.key !== 'paid' || paidOpen) && (
                <div className="flex flex-col gap-2">{g.items.map(invoiceRow)}</div>
              )}
            </section>
          ))}
        </div>
      )}

      {(overdue.data ?? []).length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="type-section">{t('invoices.overdueTitle')}</h2>
            <span className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={reminding}
                onClick={async () => {
                  setReminding(true)
                  try {
                    remindStopRef.current = makeStopFlag()
                    const run = await runFeeReminders(nurseryId!, user?.id ?? null, remindStopRef.current.shouldStop)
                    showToast(
                      t('invoices.remindersRun', {
                        attempted: run.attempted,
                        skipped: run.skippedRecent,
                      }) +
                        (run.stopped
                          ? ' — ' +
                            t('common.bulkStopped', {
                              done: run.attempted + run.skippedRecent,
                              total: run.total,
                            })
                          : ''),
                    )
                  } catch {
                    showToast(t('common.errorGeneric'), 'error')
                  } finally {
                    setReminding(false)
                  }
                }}
              >
                <MessageCircle size={16} />
                {t('invoices.remindAll')}
              </Button>
              {reminding && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remindStopRef.current.stop()}
                >
                  <OctagonX size={16} />
                  {t('common.stop')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={copyOverdue}>
                <Copy size={16} />
                {t('invoices.copyOverdue')}
              </Button>
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {(overdue.data ?? []).map((item) => {
              const wa = waLinkWithText(item.guardianPhone, reminderText(item))
              return (
                <ListRow
                  key={item.childId}
                  leading={<Avatar name={item.childName} />}
                  title={item.childName}
                  secondary={t('invoices.overdueDays', { date: item.oldestPeriod })}
                  trailing={
                    <span className="flex items-center gap-2">
                      <span className="type-badge text-bad-text">
                        {formatMoney(item.balance)}
                      </span>
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noreferrer"
                          className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-good-soft text-good-text flex items-center justify-center"
                          aria-label={t('invoices.sendReminder')}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MessageCircle size={18} />
                        </a>
                      )}
                    </span>
                  }
                />
              )
            })}
          </div>
        </section>
      )}

      <Fab
        label={t('invoices.issueNow')}
        ariaLabel={t('invoices.issueNow')}
        icon={CheckCheck}
        onClick={() => {
          setIssueResult(null)
          setIssueOpen(true)
        }}
      />
      <Sheet
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title={t('invoices.issueTitle', { period })}
        footer={
          <div className="flex gap-2">
            <Button onClick={handleIssue} disabled={mutations.issue.isPending} full>
              {mutations.issue.isPending ? t('invoices.issuing') : t('invoices.issueNow')}
            </Button>
            {mutations.issue.isPending && (
              <Button variant="soft" onClick={() => issueStopRef.current.stop()}>
                <OctagonX size={16} />
                {t('common.stop')}
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="type-secondary text-muted">{t('invoices.issueHint')}</p>
          <Field label={t('invoices.dueDate')}>
            <TextInput
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          {issueResult && (
            <p className="type-body text-good-text bg-good-soft rounded-xl px-3 py-2">
              {issueResult}
            </p>
          )}
          {issueError && <FormError message={issueError} />}
        </div>
      </Sheet>
    </div>
  )
}
