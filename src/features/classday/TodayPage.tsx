import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useT } from '../../i18n'
import { fmtWeekdayDate, todayISO } from '../../lib/format'
import { useLocale } from '../../i18n/locale'
import { useClasses } from '../classes/hooks'
import { useTodayOpenDays } from './hooks'

/**
 * «اليوم»: اختيار الفصل لفتح يومه — بوابة وضع الفصل.
 * هوية نونو — الموجة 1: كل فصل بشارة حالته «اتفتح/لسه» (من صفوف
 * أيام النهارده — قراءة فقط).
 */
export function TodayPage() {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const classes = useClasses()
  const openDays = useTodayOpenDays(todayISO())
  const opened = new Set(openDays.data ?? [])

  if (classes.isPending) return <LoadingState />
  if (classes.isError)
    return (
      <ErrorState
        message={t('common.errorGeneric')}
        onRetry={() => void classes.refetch()}
      />
    )
  const list = classes.data ?? []
  if (list.length === 0)
    return <EmptyState title={t('classes.emptyTitle')} hint={t('classes.emptyBody')} />

  return (
    <div className="flex flex-col gap-2">
      <p className="type-secondary text-muted">{fmtWeekdayDate(todayISO())}</p>
      <p className="type-secondary text-muted">{t('attendance.pickClass')}</p>
      {list.map((c) => {
        const isOpen = opened.has(c.id)
        return (
          <Card
            key={c.id}
            className="flex items-center justify-between cursor-pointer py-4"
            onClick={() => navigate(`/today/${c.id}`)}
          >
            <div>
              <div className="type-section">{c.name}</div>
              <div className="type-badge text-muted">
                {t('format.childCount', { count: c.childrenCount })}
              </div>
            </div>
            <span className="flex items-center gap-2">
              <span
                className={
                  isOpen
                    ? 'type-badge text-good-text bg-good-soft rounded-full px-2 py-1'
                    : 'type-badge text-muted bg-soft rounded-full px-2 py-1'
                }
              >
                {isOpen
                  ? t('home.classesOpened')
                  : t('home.classesNotOpened')}
              </span>
              <ChevronRight
                size={22}
                className={locale === 'ar' ? 'rotate-180 text-muted' : 'text-muted'}
              />
            </span>
          </Card>
        )
      })}
    </div>
  )
}
