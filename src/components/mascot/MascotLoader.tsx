import { Mascot } from './Mascot'
import { VersionLine } from '../ui/VersionLine'
import { useT } from '../../i18n'
import { usePrefersReducedMotion } from './useMascotVisible'

/** محمّل داخل منطقة المحتوى: علامة نونو نابضة بهدوء (تُجمّد مع تقليل الحركة) */
export function MascotLoader({ size = 64 }: { size?: number }) {
  const t = useT()
  const reduced = usePrefersReducedMotion()
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className={reduced ? undefined : 'animate-pulse'}>
        <Mascot state="loading" size={size} />
      </div>
      <p className="type-secondary">{t('common.loading')}</p>
    </div>
  )
}

/** شاشة إقلاع كاملة أثناء فحص الجلسة */
export function MascotSplash() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[var(--hatch-widget-bg)]">
      <MascotLoader size={96} />
      <VersionLine />
    </div>
  )
}
