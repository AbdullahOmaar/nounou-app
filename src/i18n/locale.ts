import { useSyncExternalStore } from 'react'

export type Locale = 'ar' | 'en'

const STORAGE_KEY = 'nounou-locale'
const EVENT = 'nounou-locale-changed'

/**
 * لغة الواجهة — عربي (افتراضي، RTL) أو إنجليزي (LTR)، من اليوم الأول
 * (حضانات اللغات في نطاق المنتج). تُحفظ محلياً وتُطبّق على <html>
 * (lang + dir) من جذر التطبيق. نمط lib/workspace نفسه.
 */
function getLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar'
  } catch {
    return 'ar'
  }
}

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // تجاهل: التخزين المحلي غير متاح
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => 'ar' as Locale)
}

/** قراءة غير تفاعلية (لخارج المكونات) */
export function currentLocale(): Locale {
  return getLocale()
}

export function localeDir(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}
