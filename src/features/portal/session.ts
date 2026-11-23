/**
 * جلسة جهاز بوابة ولي الأمر (3A-375 — الخيار أ: التوكن نفسه هو الجلسة).
 * أول فتح للرابط يلتقط التوكن الخام في localStorage وينظّف شريط
 * العنوان (فلا يبقى التوكن في سجل التصفح أو لقطات الشاشة)؛ أي زيارة
 * لاحقة لجذر البوابة بلا توكن في الرابط تقرأ الجلسة المخزنة تلقائياً.
 * تغيير الجهاز = لا جلسة مخزنة = ولي الأمر يطلب رابطاً جديداً.
 * الانتهاء منزلق خادمياً (0019): كل resolve ناجح يمدّد 180 يوماً.
 */
const KEY = 'nounou.portalToken'

export function getStoredPortalToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch (e) {
    console.warn('portal session: cannot read stored token', e)
    return null
  }
}

/**
 * يلتقط توكن الرابط (إن وُجد) ويعيد التوكن الفعّال للجلسة:
 * توكن الرابط أولاً، وإلا المخزّن، وإلا null.
 * عند الالتقاط يُحفظ التوكن ويُنظَّف شريط العنوان إلى /p.
 */
export function capturePortalToken(urlToken: string | undefined): string | null {
  if (urlToken) {
    try {
      localStorage.setItem(KEY, urlToken)
    } catch (e) {
      // وضع خاص يمنع التخزين: الجلسة تعمل لهذه الزيارة فقط
      console.warn('portal session: cannot store token', e)
    }
    window.history.replaceState(null, '', '/p')
    return urlToken
  }
  return getStoredPortalToken()
}
