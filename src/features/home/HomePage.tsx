import { useNavigate } from 'react-router-dom'
import {
  Bus,
  CalendarCheck2,
  FileText,
  Megaphone,
  ReceiptText,
  UserPlus,
} from 'lucide-react'
import { ActionTiles, ActionTile } from '../../components/ui/ActionTiles'
import { Card } from '../../components/ui/Card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { PullToRefresh } from '../../components/ui/PullToRefresh'
import { useT } from '../../i18n'
import { formatMoney } from '../../lib/format'
import { useAuth } from '../../lib/AuthProvider'
import { useCurrentNursery } from '../../hooks/useCurrentNursery'
import { useHomeSummary } from './hooks'

/**
 * الرئيسية: تحية + عدّادات اليوم الحية + إجراءات سريعة + فصول اليوم.
 * لا كروت تنبيه هنا إطلاقاً (قاعدة المالك المحفوظة — التنبيهات خلف
 * الجرس فقط)؛ العدّادات أرقام حالة لا تنبيهات.
 */
export function HomePage() {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
  const nursery = useCurrentNursery()
  const summary = useHomeSummary()
  const displayName =
    (typeof user?.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name
      : '') || ''

  if (summary.isPending) return <LoadingState />
  if (summary.isError || !summary.data)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void summary.refetch()}
      />
    )
  const s = summary.data
  const isOwner = nursery.status === 'ready' && nursery.isOwner

  return (
    <PullToRefresh onRefresh={() => summary.refetch()}>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="type-title">
            {t('home.greeting', { name: displayName || t('shell.appName') })}
          </h1>
          <p className="type-secondary text-muted">{t('home.todaySummary')}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Card className="text-center py-3">
            <div className="type-title">{s.presentToday}</div>
            <div className="type-badge text-muted">{t('home.presentToday')}</div>
          </Card>
          <Card className="text-center py-3">
            <div className="type-title">{s.notPickedUp}</div>
            <div className="type-badge text-muted">{t('home.notPickedUpYet')}</div>
          </Card>
          <Card className="text-center py-3">
            <div className="type-title">{s.absentToday}</div>
            <div className="type-badge text-muted">{t('home.absentToday')}</div>
          </Card>
          <Card className="text-center py-3">
            <div className="type-title">{s.reportsMissing}</div>
            <div className="type-badge text-muted">{t('home.reportsMissing')}</div>
          </Card>
          {isOwner && (
            <>
              <Card className="text-center py-3">
                <div className="type-title">{formatMoney(s.overdueTotal ?? 0)}</div>
                <div className="type-badge text-muted">{t('home.overdueTotal')}</div>
              </Card>
              <Card className="text-center py-3">
                <div className="type-title">{s.pendingProofs ?? 0}</div>
                <div className="type-badge text-muted">{t('home.pendingProofs')}</div>
              </Card>
            </>
          )}
          <Card className="text-center py-3">
            <div className="type-title">{s.childrenTotal}</div>
            <div className="type-badge text-muted">{t('home.childrenRegistered')}</div>
          </Card>
          <Card className="text-center py-3">
            <div className="type-title">{s.staffTotal}</div>
            <div className="type-badge text-muted">{t('home.staffCount')}</div>
          </Card>
        </div>

        <section>
          <h2 className="type-section mb-2">{t('home.quickActions')}</h2>
          <ActionTiles>
            <ActionTile
              icon={CalendarCheck2}
              label={t('home.actionToday')}
              onClick={() => navigate('/today')}
            />
            <ActionTile
              icon={UserPlus}
              label={t('home.actionAddChild')}
              onClick={() => navigate('/children')}
            />
            <ActionTile
              icon={FileText}
              label={t('home.actionReports')}
              onClick={() => navigate('/reports')}
            />
            <ActionTile
              icon={Bus}
              label={t('home.actionBus')}
              onClick={() => navigate('/bus')}
            />
            {isOwner && (
              <ActionTile
                icon={ReceiptText}
                label={t('home.actionInvoices')}
                onClick={() => navigate('/invoices')}
              />
            )}
            <ActionTile
              icon={Megaphone}
              label={t('home.actionAnnounce')}
              onClick={() => navigate('/announcements')}
            />
          </ActionTiles>
        </section>

        <section>
          <h2 className="type-section mb-2">{t('home.classesToday')}</h2>
          <div className="flex flex-col gap-2">
            {s.classes.map((c) => (
              <Card
                key={c.id}
                className="flex items-center justify-between cursor-pointer py-3"
                onClick={() => navigate(`/today/${c.id}`)}
              >
                <span className="type-body">{c.name}</span>
                <span className="type-badge text-muted">
                  {c.present} / {c.total}
                </span>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </PullToRefresh>
  )
}
