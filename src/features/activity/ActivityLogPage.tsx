import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Baby,
  Bus,
  ClipboardList,
  FileText,
  Link2,
  Megaphone,
  ReceiptText,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Chip, ChipRow, TextInput } from '../../components/ui/form'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { CAIRO_TZ, formatClock12, fmtWeekdayDate, todayISO } from '../../lib/format'
import { requireSupabase } from '../../lib/supabase'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import type { ActivityLogRow } from '../../types/database'

/** مفتاح يوم القاهرة (YYYY-MM-DD) لطابع زمني — تجميع الخط الزمني */
function dayKeyOf(ts: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts))
}

/** سجل النشاط: أحدث عمليات الحضانة بترتيب زمني عكسي */
export function ActivityLogPage() {
  const t = useT()
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<string | null>(null)
  const nursery = useCurrentNursery()
  const nurseryId = nursery.status === 'ready' ? nursery.nurseryId : null
  const activity = useQuery({
    queryKey: ['activity', nurseryId],
    enabled: Boolean(nurseryId),
    queryFn: async (): Promise<ActivityLogRow[]> => {
      const db = requireSupabase()
      const { data, error } = await db
        .from('activity_log')
        .select('*')
        .eq('nursery_id', nurseryId!)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as ActivityLogRow[]
    },
  })

  const list = useMemo(() => activity.data ?? [], [activity.data])

  const kindLabel = (kind: string): string => {
    switch (kind) {
      case 'child_created':
        return t('activity.kind.child_created')
      case 'child_updated':
        return t('activity.kind.child_updated')
      case 'invoice_issued':
        return t('activity.kind.invoice_issued')
      case 'payment_recorded':
        return t('activity.kind.payment_recorded')
      case 'payment_reversed':
        return t('activity.kind.payment_reversed')
      case 'proof_approved':
        return t('activity.kind.proof_approved')
      case 'proof_rejected':
        return t('activity.kind.proof_rejected')
      case 'report_published':
        return t('activity.kind.report_published')
      case 'announcement_published':
        return t('activity.kind.announcement_published')
      case 'member_invited':
        return t('activity.kind.member_invited')
      case 'member_removed':
        return t('activity.kind.member_removed')
      case 'child_archived':
        return t('activity.kind.child_archived')
      case 'settings_updated':
        return t('activity.kind.settings_updated')
      case 'pickup_code_failed':
        return t('activity.kind.pickup_code_failed')
      case 'bus_trip_closed':
        return t('activity.kind.bus_trip_closed')
      case 'data_request_handled':
      return t('activity.dataRequestHandled')
    case 'salary_paid':
      return t('activity.salaryPaid')
    case 'assistant_executed':
      return t('activity.assistantExecuted')
    case 'expense_recorded':
        return t('activity.kind.expense_recorded')
      case 'expense_deleted':
        return t('activity.kind.expense_deleted')
      case 'cashbox_entry_added':
        return t('activity.kind.cashbox_entry_added')
      case 'cashbox_entry_deleted':
        return t('activity.kind.cashbox_entry_deleted')
      case 'cashbox_closed':
        return t('activity.kind.cashbox_closed')
      case 'supplier_added':
        return t('activity.kind.supplier_added')
      case 'order_added':
        return t('activity.kind.order_added')
      case 'supplier_paid':
        return t('activity.kind.supplier_paid')
      case 'approval_requested':
        return t('activity.kind.approval_requested')
      case 'approval_approved':
        return t('activity.kind.approval_approved')
      case 'approval_rejected':
        return t('activity.kind.approval_rejected')
      case 'fee_reminders_run':
        return t('activity.kind.fee_reminders_run')
      case 'qa_session_created':
        return t('activity.kind.qa_session_created')
      case 'tour_converted':
        return t('activity.kind.tour_converted')
      case 'event_created':
        return t('activity.kind.event_created')
      case 'message_sent':
        return t('activity.kind.message_sent')
      case 'link_issued':
        return t('activity.kind.link_issued')
      case 'link_revoked':
        return t('activity.kind.link_revoked')
      default:
        return kind
    }
  }

  // تجميع زمني + بحث وتصفية عميلية فوق نفس الـ100 حدث (الموجة 5):
  // لا استعلامات جديدة — التصفية عرض فقط فوق البيانات المحمّلة.
  const kindIcon = (kind: string) => {
    if (kind.startsWith('child_')) return Baby
    switch (kind) {
      case 'invoice_issued':
        return ReceiptText
      case 'payment_recorded':
      case 'payment_reversed':
        return Wallet
      case 'proof_approved':
      case 'proof_rejected':
        return ShieldCheck
      case 'report_published':
        return FileText
      case 'announcement_published':
        return Megaphone
      case 'member_invited':
      case 'member_removed':
        return Users
      case 'settings_updated':
        return SettingsIcon
      case 'bus_trip_closed':
        return Bus
      case 'link_issued':
      case 'link_revoked':
        return Link2
      default:
        return ClipboardList
    }
  }
  const todayKey = todayISO()
  const yesterdayKey = dayKeyOf(new Date(Date.now() - 86_400_000).toISOString())
  const dayLabel = (key: string): string =>
    key === todayKey
      ? t('activity.today')
      : key === yesterdayKey
        ? t('activity.yesterday')
        : fmtWeekdayDate(key)
  const kindsPresent = useMemo(
    () => [...new Set(list.map((i) => i.kind))],
    [list],
  )
  const filtered = list.filter(
    (i) =>
      (!kindFilter || i.kind === kindFilter) &&
      (!query ||
        kindLabel(i.kind).includes(query) ||
        (i.summary ?? '').includes(query)),
  )
  const groups = useMemo(() => {
    const map = new Map<string, ActivityLogRow[]>()
    for (const item of filtered) {
      const key = dayKeyOf(item.created_at)
      const arr = map.get(key) ?? []
      arr.push(item)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [filtered])

  if (activity.isPending) return <LoadingState />
  if (activity.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void activity.refetch()}
      />
    )
  if (list.length === 0) return <EmptyState title={t('activity.empty')} />

  return (
    <div className="flex flex-col gap-3">
      <TextInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('activity.searchPlaceholder')}
      />
      <ChipRow>
        <Chip active={!kindFilter} onClick={() => setKindFilter(null)}>
          {t('activity.filterAll')}
        </Chip>
        {kindsPresent.map((k) => (
          <Chip
            key={k}
            active={kindFilter === k}
            onClick={() => setKindFilter(kindFilter === k ? null : k)}
          >
            {kindLabel(k)}
          </Chip>
        ))}
      </ChipRow>
      {filtered.length === 0 && <EmptyState title={t('activity.empty')} />}
      {groups.map(([day, items]) => (
        <Card key={day} className="py-2">
          <div className="type-section px-1 pb-1">{dayLabel(day)}</div>
          <div className="flex flex-col divide-y divide-border">
            {items.map((item) => {
              const Icon = kindIcon(item.kind)
              return (
                <div key={item.id} className="flex items-center gap-3 py-3 px-1">
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-soft text-primary flex items-center justify-center">
                    <Icon size={20} />
                  </span>
                  <span className="type-body flex-1">
                    {kindLabel(item.kind)}
                    {item.summary ? ` — ${item.summary}` : ''}
                  </span>
                  <span className="type-badge text-muted shrink-0">
                    {formatClock12(item.created_at)}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}
