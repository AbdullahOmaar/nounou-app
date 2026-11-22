import * as Sentry from '@sentry/react'

/**
 * تتبّع أخطاء العميل (3A-350 — دفعة تقوية ما بعد التفعيل).
 *
 * خامل تماماً بلا DSN: من غير `VITE_SENTRY_DSN` لا يُهيَّأ شيء ولا
 * تُرسَل أي بيانات — فيعمل التطوير والديمو المحلي كما هما. عند
 * التفعيل يُضبط الـ DSN في بيئة النشر فقط (انظر docs/ACTIVATION.md).
 *
 * الخصوصية أولاً: SDK v11 لا يرسل أي PII افتراضياً أصلاً، ولا تتبّع
 * أداء (tracesSampleRate: 0 — الحصة المجانية للأخطاء فقط)، ولا إعادة
 * تشغيل جلسات. الإصدار يُربط برقم نسخة التطبيق الواحد __APP_VERSION__.
 */
let initialized = false

export function initSentry(): void {
  if (initialized) return
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return
  Sentry.init({
    dsn,
    release: `nounou@${__APP_VERSION__}`,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  })
  initialized = true
}

/** إبلاغ خطأ مُلتقَط يدوياً (حدّ الخطأ الجذري) — صامت بلا تهيئة. */
export function reportError(error: unknown): void {
  if (!initialized) return
  Sentry.captureException(error)
}
