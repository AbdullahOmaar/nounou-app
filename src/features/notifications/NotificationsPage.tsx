import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { formatMoney } from '../../lib/format'
import type { AlertItem, AlertKind } from './api'
import { useAlerts } from './hooks'

const KIND_ROUTE: Record<AlertKind, string> = {
  notPickedUp: '/today',
  proofsPending: '/proofs',
  overdue: '/invoices',
  reportsMissing: '/reports',
  absentStreak: '/children',
}

/** صفحة الإشعارات: أقسام قابلة للطي لكل نوع تنبيه (قاعدة المالك المحفوظة) */
export function NotificationsPage() {
  const t = useT()
  const navigate = useNavigate()
  const alerts = useAlerts()
  const [openKinds, setOpenKinds] = useState<Set<AlertKind>>(new Set())

  if (alerts.isPending) return <LoadingState />
  if (alerts.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void alerts.refetch()}
      />
    )
  const list = alerts.data ?? []
  if (list.length === 0) return <EmptyState title={t('notifications.empty')} />

  const kindLabel = (kind: AlertKind): string => {
    switch (kind) {
      case 'notPickedUp':
        return t('notifications.kind.notPickedUp')
      case 'proofsPending':
        return t('notifications.kind.proofsPending')
      case 'overdue':
        return t('notifications.kind.overdue')
      case 'reportsMissing':
        return t('notifications.kind.reportsMissing')
      case 'absentStreak':
        return t('notifications.kind.absentStreak')
    }
  }

  const body = (a: AlertItem): string => {
    switch (a.kind) {
      case 'notPickedUp':
        return t('notifications.notPickedUpBody', { count: a.count })
      case 'proofsPending':
        return t('notifications.proofsPendingBody', { count: a.count })
      case 'overdue':
        return t('notifications.overdueBody', { amount: formatMoney(a.amount ?? 0) })
      case 'reportsMissing':
        return t('notifications.reportsMissingBody', { count: a.count })
      case 'absentStreak':
        return t('notifications.absentStreakBody', {
          name: a.childName ?? '',
          count: a.count,
        })
    }
  }

  const byKind = new Map<AlertKind, AlertItem[]>()
  for (const a of list) {
    const arr = byKind.get(a.kind) ?? []
    arr.push(a)
    byKind.set(a.kind, arr)
  }

  return (
    <div className="flex flex-col gap-2">
      {[...byKind.entries()].map(([kind, items]) => {
        const open = openKinds.has(kind)
        return (
          <Card key={kind} className="py-3">
            <button
              className="flex items-center justify-between w-full bg-transparent border-0 cursor-pointer text-text"
              onClick={() => {
                const next = new Set(openKinds)
                if (open) next.delete(kind)
                else next.add(kind)
                setOpenKinds(next)
              }}
            >
              <span className="type-section">{kindLabel(kind)}</span>
              <ChevronDown
                size={20}
                className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
            {open && (
              <div className="mt-2 flex flex-col gap-2">
                {items.map((a, i) => (
                  <button
                    key={i}
                    className="text-start bg-soft rounded-xl px-3 py-2 type-body cursor-pointer border-0 text-text"
                    onClick={() => navigate(KIND_ROUTE[kind])}
                  >
                    {body(a)}
                  </button>
                ))}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
