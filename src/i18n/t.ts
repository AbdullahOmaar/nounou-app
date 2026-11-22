import { ar } from './ar'
import { en } from './en'
import { currentLocale, useLocale, type Locale } from './locale'
import type { Dict, I18nKey, Msg, Params } from './dict'

const DICTS: Record<Locale, Dict> = { ar, en }
const PLURAL_RULES: Record<Locale, Intl.PluralRules> = {
  ar: new Intl.PluralRules('ar-EG'),
  en: new Intl.PluralRules('en-US'),
}

function lookup(dict: Dict, key: string): Msg | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    // اجتياز بالخصائص الذاتية فقط (تصليب موروث من المدرس 3A-302):
    // أجزاء مثل «__proto__» لا تُقرأ من سلسلة البروتوتايب أبداً.
    if (!Object.hasOwn(node, part)) return undefined
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' || (typeof node === 'object' && node !== null)
    ? (node as Msg)
    : undefined
}

/**
 * ترجمة مفتاح من قاموس اللغة النشطة: استيفاء {name}، واختيار صيغة الجمع
 * بفئة CLDR عند وجود count رقمي وقيمة جمعية. مفتاح مفقود يعيد نفسه
 * (يظهر في التطوير بدل فراغ صامت) — وبوابة الأنواع تمنع حدوثه أصلاً.
 */
export function t(key: I18nKey, params?: Params): string {
  const locale = currentLocale()
  const raw = lookup(DICTS[locale], key) ?? lookup(ar, key)
  if (raw === undefined) return key
  let str: string
  if (typeof raw === 'string') {
    str = raw
  } else {
    const count = params?.count
    const category =
      typeof count === 'number' ? PLURAL_RULES[locale].select(count) : 'other'
    str = raw[category] ?? raw.other
  }
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (match, name: string) =>
      params[name] !== undefined ? String(params[name]) : match,
    )
  }
  return str
}

/** خطاف المكونات: يشترك في اللغة فتُعاد كتابة الواجهة فور التبديل */
export function useT(): typeof t {
  useLocale()
  return t
}
