import { t } from '../i18n'
import { currentLocale } from '../i18n/locale'

/**
 * المنطقة الزمنية التجارية للمنتج (عيبا الفحص الحي 1+2، 2026-11-25):
 * كل عرض تاريخ/وقت يُحسب بتوقيت القاهرة صراحةً — لا بتوقيت جهاز
 * المشاهِد — فوصول سُجِّل منتصف الليل UTC لا يظهر «2:00 ص»، وتاريخ
 * «2026-11-25» لا ينقلب يوماً في متصفح غرب UTC.
 */
export const CAIRO_TZ = 'Africa/Cairo'

/** تنسيق مبلغ: فواصل آلاف + عملة القاموس */
export function formatMoney(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return t('format.egp', {
    amount: (Math.round(safe * 100) / 100).toLocaleString('en-US', {
      maximumFractionDigits: 2,
    }),
  })
}

/** "HH:MM:SS" → "HH:MM" */
export function shortTime(v: string): string {
  return v.slice(0, 5)
}

/** "HH:MM(:SS)" 24h → 12h بلاحقة القاموس */
export function formatTime12(v: string): string {
  const [hRaw, mRaw] = v.split(':')
  const h = parseInt(hRaw, 10)
  const m = parseInt(mRaw ?? '0', 10)
  if (Number.isNaN(h)) return v
  const suffix = h < 12 ? t('format.amSuffix') : t('format.pmSuffix')
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** وقت لحظة ISO → 12h (بتوقيت القاهرة دائماً) */
export function formatClock12(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00'
  return formatTime12(`${get('hour')}:${get('minute')}`)
}

/** تاريخ «YYYY-MM-DD» أو لحظة ISO → «الأربعاء، 25 نوفمبر 2026» (بتوقيت القاهرة) */
export function fmtWeekdayDate(value: string): string {
  const d = new Date(
    value.length === 10 ? `${value}T12:00:00` : value,
  )
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(
    currentLocale() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US',
    {
      timeZone: CAIRO_TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    },
  ).format(d)
}

/** "HH:MM" → دقائق من منتصف الليل */
export function timeToMin(v: string): number {
  const [h, m] = v.split(':').map((x) => parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}

/** تاريخ اليوم المحلي بصيغة YYYY-MM-DD (بلا انحراف منطقة زمنية) */
export function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** فترة الشهر الحالي 'YYYY-MM' */
export function currentPeriod(): string {
  return todayISO().slice(0, 7)
}

/** إزاحة تاريخ ISO بعدد أيام (للتنقل بين الأيام في البوابة/اليوم) */
export function shiftISODate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * سن الطفل من تاريخ الميلاد: «٤ سنوات» / «سنتان و٣ شهور» بصيغ جمع القاموس.
 * يعيد null بلا تاريخ ميلاد.
 */
export function ageLabel(birthDate: string | null, now = new Date()): string | null {
  if (!birthDate) return null
  const b = new Date(`${birthDate}T12:00:00`)
  if (Number.isNaN(b.getTime())) return null
  let months =
    (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months -= 1
  if (months < 0) return null
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return t('format.monthsOld', { count: rest })
  const yearPart = t('format.yearsOld', { count: years })
  if (rest === 0) return yearPart
  return `${yearPart} ${t('format.andWord')} ${t('format.monthsOld', { count: rest })}`
}

/** رابط خارجي آمن: http/https فقط (مراجعة أمان موروثة C-01) */
export function safeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? raw : null
  } catch {
    return null
  }
}

/** رابط واتساب من رقم مصري/دولي — يعيد null لرقم غير صالح */
export function waLink(phone: string | null | undefined): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = `20${digits.slice(1)}`
  if (digits.length < 10 || digits.length > 15) return null
  return `https://wa.me/${digits}`
}

/** رابط واتساب بنص جاهز */
export function waLinkWithText(
  phone: string | null | undefined,
  text: string,
): string | null {
  const base = waLink(phone)
  return base ? `${base}?text=${encodeURIComponent(text)}` : null
}

/** تاريخ/وقت ISO → عرض محلي قصير */
export function formatDateTimeAr(iso: string, fallback = ''): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  const date = new Intl.DateTimeFormat(
    currentLocale() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US',
    { timeZone: CAIRO_TZ, day: 'numeric', month: 'numeric', year: 'numeric' },
  ).format(d)
  return `${date} — ${formatClock12(iso)}`
}
