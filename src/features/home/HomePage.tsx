import { useNavigate } from 'react-router-dom'
import { Bus, FileText, Play, Users } from 'lucide-react'
import { ActionTiles, ActionTile } from '../../components/ui/ActionTiles'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { PullToRefresh } from '../../components/ui/PullToRefresh'
import { useT } from '../../i18n'
import { fmtWeekday, fmtWeekdayDate, todayISO } from '../../lib/format'
import { useAuth } from '../../lib/AuthProvider'
import { useHomeSummary } from './hooks'

/**
 * الرئيسية — هوية نونو، الموجة 1 (DESIGN §5.1 شاشة 1): بطل واحد —
 * بطاقة اليوم الكحلية (حاضر/غائب/لسه) — + زر أساسي واحد (ابدأ حضور
 * اليوم) + 3 إجراءات سريعة بس؛ روابط الإعدادات/التصدير/الأعضاء
 * أُزيلت من الرئيسية نهائيًا (قرار 7 — مكانها «المزيد»، الموجة 5).
 * لا كروت تنبيه هنا إطلاقاً (قاعدة المالك المحفوظة — التنبيهات خلف
 * الجرس فقط)؛ العدّادات أرقام حالة لا تنبيهات.
 */
export function HomePage() {
  const t = useT()
  const navigate = useNavigate()
  const { user } = useAuth()
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
  const notArrived = Math.max(
    0,
    s.childrenTotal - s.presentToday - s.absentToday,
  )

  return (
    <PullToRefresh onRefresh={() => summary.refetch()}>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="type-title">
            {t('home.greeting', { name: displayName || t('shell.appName') })}
          </h1>
          <p className="type-secondary text-muted">{fmtWeekdayDate(todayISO())}</p>
          <p className="type-secondary text-muted">{t('home.todaySummary')}</p>
        </div>

        {/* بطل اليوم: بطاقة كحلية — حالة النهاردة في 5 ثواني */}
        <div className="bg-primary text-on-primary rounded-2xl p-4 shadow-card">
          <h2 className="type-title">
            {t('home.heroTitle', { weekday: fmtWeekday(todayISO()) })}
          </h2>
          <p className="type-secondary text-on-primary-muted mt-1">
            {t('home.heroSubtitle', {
              classes: s.classes.length,
              count: s.childrenTotal,
            })}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="bg-on-primary/15 rounded-xl py-3 text-center">
              <div className="type-title">{s.presentToday}</div>
              <div className="type-badge text-on-primary-muted">
                {t('attendance.present')}
              </div>
            </div>
            <div className="bg-on-primary/15 rounded-xl py-3 text-center">
              <div className="type-title">{s.absentToday}</div>
              <div className="type-badge text-on-primary-muted">
                {t('attendance.absent')}
              </div>
            </div>
            <div className="bg-on-primary/15 rounded-xl py-3 text-center">
              <div className="type-title">{notArrived}</div>
              <div className="type-badge text-on-primary-muted">
                {t('attendance.notYetArrived')}
              </div>
            </div>
          </div>
        </div>

        <Button full onClick={() => navigate('/today')}>
          <Play size={18} />
          {t('home.startDay')}
        </Button>

        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="type-section">{t('home.quickActions')}</h2>
            <span className="type-badge text-accent-text">
              {t('home.quickActionsNote')}
            </span>
          </div>
          <ActionTiles>
            <ActionTile
              icon={Users}
              label={t('home.actionChildren')}
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
          </ActionTiles>
        </section>

        <section>
          <h2 className="type-section mb-2">{t('home.classesToday')}</h2>
          <Card className="p-0 overflow-hidden">
            <div className="flex flex-col divide-y divide-border">
              {s.classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => navigate(`/today/${c.id}`)}
                  className="flex items-center gap-3 px-4 py-3 text-start min-h-[56px] hover:bg-soft"
                >
                  <span className="w-10 h-10 shrink-0 rounded-full bg-soft text-primary flex items-center justify-center type-section">
                    {c.name.charAt(0)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block type-body truncate">{c.name}</span>
                    <span className="block type-badge text-muted">
                      <span dir="ltr">
                        {c.present} / {c.total}
                      </span>
                    </span>
                  </span>
                  <span
                    className={
                      c.opened
                        ? 'type-badge text-good-text bg-good-soft rounded-full px-2 py-1 shrink-0'
                        : 'type-badge text-muted bg-soft rounded-full px-2 py-1 shrink-0'
                    }
                  >
                    {c.opened
                      ? t('home.classesOpened')
                      : t('home.classesNotOpened')}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </PullToRefresh>
  )
}
