import { useT } from '../../i18n'
import { formatDateTimeAr } from '../../lib/format'

/**
 * سطر الإصدار (قاعدة مالك 2026-11-25): «الإصدار X — نُشر
 * [التاريخ والوقت]» — مبني من بيانات البناء نفسه
 * (__APP_VERSION__ من package.json + __BUILD_TIME__ وقت
 * البناء) لا مكتوب يدوياً. يظهر في السبلاش وفي قاع
 * التطبيق؛ من غيره لا يمر النشر من المراجعة.
 */
export function VersionLine({ className = '' }: { className?: string }) {
  const t = useT()
  return (
    <p className={`text-center text-xs text-muted ${className}`} dir="ltr">
      {t('common.version')} {__APP_VERSION__} — {t('common.publishedAt')}{' '}
      {formatDateTimeAr(__BUILD_TIME__)}
    </p>
  )
}
