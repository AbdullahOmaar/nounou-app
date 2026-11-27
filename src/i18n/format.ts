import { currentLocale } from './locale'

/**
 * تنسيقات Intl حسب اللغة النشطة. قرار الأرقام الموثّق (موروث من المدرس):
 * أرقام لاتينية وفواصل آلاف ASCII في كل الشاشات (u-nu-latn) — عرض موحّد
 * في العربي والإنجليزي معاً.
 */
function intlLocale(): string {
  return currentLocale() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US'
}

/** المنطقة الزمنية التجارية — كل التواريخ تُعرض بتوقيت القاهرة (عيبا الفحص 1+2) */
const CAIRO_TZ = 'Africa/Cairo' 

/** فئة جمع CLDR لعدد في اللغة النشطة */
export function pluralCategory(count: number): Intl.LDMLPluralRule {
  return new Intl.PluralRules(intlLocale()).select(count)
}

/** تاريخ طويل (مثال: «22 نوفمبر 2026» / "November 22, 2026") */
export function fmtDateLong(date: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: CAIRO_TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** تاريخ قصير (يوم/شهر/سنة) */
export function fmtDateShort(date: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: CAIRO_TZ,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date)
}

/** اسم الشهر + السنة لفترة فاتورة 'YYYY-MM' */
export function fmtPeriod(period: string): string {
  const [y, m] = period.split('-').map((x) => parseInt(x, 10))
  if (!y || !m) return period
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: CAIRO_TZ,
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, 1, 12))
}
