import { PushNotifications } from '@capacitor/push-notifications'
import { isNativeApp } from './native'

/**
 * إشعارات الدفع الأصلية (3A-412 خطوة 3 — الشق العميل): على التطبيق
 * الأصلي فقط نطلب الإذن ونسجّل الجهاز لدى FCM/APNs ونحفظ التوكن
 * محلياً. ربط التوكن بالمستخدم خادمياً (جدول + إرسال) خطوة لاحقة
 * موثقة في docs/MOBILE-APP.md — حتى تصل، التوكن المحفوظ هو نقطة
 * الربط الجاهزة. على الويب الدالة لا تفعل شيئاً إطلاقاً.
 * أي فشل يُسجَّل ولا يكسر بدء التطبيق أبداً (ميزة نائمة حتى تكتمل).
 */
const TOKEN_STORAGE_KEY = 'nounou.pushToken'

export function storedPushToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    // التخزين غير متاح (وضع خاص/متصفح مقيد): لا توكن محفوظاً
    return null
  }
}

export async function initPushNotifications(): Promise<void> {
  if (!isNativeApp()) return
  try {
    let receive = (await PushNotifications.checkPermissions()).receive
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      receive = (await PushNotifications.requestPermissions()).receive
    }
    if (receive !== 'granted') return
    await PushNotifications.addListener('registration', (token) => {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token.value)
      } catch {
        // التخزين غير متاح: التوكن يُعاد تسجيله في الإقلاع التالي
      }
    })
    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] registration error', err)
    })
    await PushNotifications.register()
  } catch (err) {
    console.warn('[push] init failed', err)
  }
}
