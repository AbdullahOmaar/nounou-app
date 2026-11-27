import { PushNotifications } from '@capacitor/push-notifications'
import { isNativeApp, nativePlatform } from './native'
import { requireSupabase } from './supabase'

/**
 * إشعارات الدفع الأصلية (3A-412 — الخطوة الخادمية، هجرة 0061): على
 * التطبيق الأصلي فقط نطلب الإذن ونسجّل الجهاز لدى FCM/APNs، ثم نربط
 * التوكن بالمستخدم خادمياً عبر RPC ‏register_push_token (جدول
 * push_tokens — توكن واحد لكل حضانة/مستخدم/منصة). الإرسال نفسه يتم
 * خادمياً من صندوق push_outbox عبر دالة send-push كل دقيقة، ويُفعَّل
 * لكل حضانة من الإعدادات (push_enabled — افتراضياً مقفول).
 * الإرسال الفعلي إلى FCM يحتاج سرّ حساب خدمة Firebase
 * (FCM_SERVICE_ACCOUNT) — بدونه تبقى الصفوف queued.
 * على الويب لا شيء إطلاقاً. أي فشل يُسجَّل ولا يكسر بدء التطبيق أبداً.
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

type TokenListener = (token: string) => void
const tokenListeners = new Set<TokenListener>()

/** اشتراك في وصول توكن جهاز جديد (للتسجيل الخادمي فور وصوله). */
export function onPushToken(listener: TokenListener): () => void {
  tokenListeners.add(listener)
  return () => {
    tokenListeners.delete(listener)
  }
}

function notifyTokenListeners(token: string): void {
  for (const listener of tokenListeners) {
    try {
      listener(token)
    } catch (err) {
      console.warn('[push] token listener failed', err)
    }
  }
}

const registeredKeys = new Set<string>()

/**
 * ربط توكن الجهاز بالمستخدم خادمياً في الحضانة النشطة. Upsert آمن
 * (نفس التوكن لنفس الحضانة لا يُعاد تسجيله في الجلسة نفسها).
 * الفشل يُسجَّل فقط — التطبيق يستمر بلا دفع.
 */
export async function registerPushTokenServerSide(
  nurseryId: string,
  token?: string,
): Promise<void> {
  if (!isNativeApp()) return
  const value = token ?? storedPushToken()
  if (!value) return
  const key = `${nurseryId}:${value}`
  if (registeredKeys.has(key)) return
  try {
    const db = requireSupabase()
    const { error } = await db.rpc('register_push_token', {
      p_nursery: nurseryId,
      p_platform: nativePlatform(),
      p_token: value,
    })
    if (error) throw error
    registeredKeys.add(key)
  } catch (err) {
    console.warn('[push] server registration failed', err)
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
      notifyTokenListeners(token.value)
    })
    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] registration error', err)
    })
    await PushNotifications.register()
  } catch (err) {
    console.warn('[push] init failed', err)
  }
}
