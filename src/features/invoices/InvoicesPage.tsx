import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCheck, Copy, MessageCircle } from 'lucide-react'
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
import { fmtPeriod } from '../../i18n/format'
import { currentPeriod, formatMoney, waLinkWithText } from '../../lib/format'
import { useNurserySettings } from '../settings/hooks'
import { useInvoices, useInvoiceMutations, useOverdue } from './hooks'

/**
 * الفواتير (للمالك فقط — المشرفات لا يصلن هنا أصلاً بحكم RLS فتظهر لهن
 * حالة فارغة): قائمة الشهر + إصدار جماعي + قسم المتأخرات برسائل جاهزة.
 */
export function InvoicesPage() {
  const t = useT()
  const navigate = useNavigate()
  const showToast = useToast()
  const [period, setPeriod] = useState(currentPeriod())
  const invoices = useInvoices(period)
  const overdue = useOverdue()
  const settings = useNurserySettings()
  const mutations = useInvoiceMutations()
  const [issueOpen, setIssueOpen] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issueResult, setIssueResult] = useState<string | null>(null)

  const totals = useMemo(() => {
    const list = (invoices.data ?? []).filter((i) => i.status !== 'cancelled')
    return {
      total: list.reduce((s, i) => s + i.total, 0),
      paid: list.reduce((s, i) => s + i.paid, 0),
      balance: list.reduce((s, i) => s + i.balance, 0),
    }
  }, [invoices.data])

  async function handleIssue() {
    setIssueError(null)
    try {
      const res = await mutations.issue.mutateAsync({
        period,
        dueDate: dueDate || null,
      })
      setIssueResult(
        `${t('invoices.issueDone', { count: res.issued })}${res.skipped ? ` — ${t('invoices.issueSkipped', { count: res.skipped })}` : ''}`,
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
        <TextInput
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="w-44"
          aria-label={t('invoices.filterPeriod')}
        />
        <span className="type-secondary text-muted">{fmtPeriod(period)}</span>
      </div>

      <Card className="flex justify-around text-center py-3">
        <div>
          <div className="type-badge text-muted">{t('invoices.total')}</div>
          <div className="type-section">{formatMoney(totals.total)}</div>
        </div>
        <div>
          <div className="type-badge text-muted">{t('invoices.paid')}</div>
          <div className="type-section text-good-text">{formatMoney(totals.paid)}</div>
        </div>
        <div>
          <div className="type-badge text-muted">{t('invoices.balance')}</div>
          <div className="type-section text-bad-text">{formatMoney(totals.balance)}</div>
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
        <div className="flex flex-col gap-2">
          {(invoices.data ?? []).map((inv) => (
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
                ) : inv.balance <= 0 ? (
                  <span className="type-badge text-good-text">{t('invoices.settled')}</span>
                ) : (
                  <span className="type-badge text-bad-text bg-bad-soft rounded-full px-2 py-1">
                    {formatMoney(inv.balance)}
                  </span>
                )
              }
            />
            </button>
          ))}
        </div>
      )}

      {(overdue.data ?? []).length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="type-section">{t('invoices.overdueTitle')}</h2>
            <Button variant="ghost" size="sm" onClick={copyOverdue}>
              <Copy size={16} />
              {t('invoices.copyOverdue')}
            </Button>
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
                          className="w-10 h-10 rounded-full bg-good-soft text-good-text flex items-center justify-center"
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
          <Button onClick={handleIssue} disabled={mutations.issue.isPending} full>
            {mutations.issue.isPending ? t('invoices.issuing') : t('invoices.issueNow')}
          </Button>
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
