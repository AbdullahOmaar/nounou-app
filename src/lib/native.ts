import { Capacitor } from '@capacitor/core'

/**
 * كشف بيئة التطبيق الأصلي (3A-412): الويب الحالي نفسه يعمل داخل غلاف
 * Capacitor على أندرويد/iOS. كل الميزات الأصلية (دفع/مسح) تُبنى فوق
 * هذا الكشف — وعلى الويب/PWA ترجع false فلا يتغير أي سلوك قائم.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/** 'android' | 'ios' | 'web' */
export function nativePlatform(): string {
  return Capacitor.getPlatform()
}
