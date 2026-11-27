/**
 * فحص الصادر (2.6 — قانون حماية البيانات 151/2020): رسائل الطاقم
 * للأهالي لا تحمل بيانات حساسة مُعرّفة أبداً. الفحص حتمي محلي:
 * - رقم قومي مصري: 14 رقماً متتالية (بعد إزالة المسافات/الشرطات)
 * - رقم بطاقة دفع: 16 رقماً متتالية بنفس التطبيع
 * أي نمط آخر (هواتف عادية 11 رقماً، مبالغ، تواريخ) مسموح — الهاتف
 * وسيلة التواصل نفسها وليس سراً في هذا السياق.
 */
export type OutboundBlock = 'national_id' | 'card_number'

export function checkOutboundMessage(
  body: string,
): { ok: true } | { ok: false; reason: OutboundBlock } {
  const digits = body.replace(/[\s-]/g, '')
  if (/\d{16}/.test(digits)) return { ok: false, reason: 'card_number' }
  if (/\d{14}/.test(digits)) return { ok: false, reason: 'national_id' }
  return { ok: true }
}
