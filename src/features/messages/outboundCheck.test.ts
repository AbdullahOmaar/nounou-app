import { describe, expect, it } from 'vitest'
import { checkOutboundMessage } from './outboundCheck'

describe('checkOutboundMessage — فحص الصادر (قانون 151)', () => {
  it('رسالة عادية تمر', () => {
    expect(checkOutboundMessage('أهلاً بحضرتك، التقرير اتنشر')).toEqual({ ok: true })
  })
  it('هاتف 11 رقماً مسموح (وسيلة التواصل نفسها)', () => {
    expect(checkOutboundMessage('كلمنا على 01001234567')).toEqual({ ok: true })
  })
  it('رقم قومي 14 رقماً يُحظر', () => {
    expect(checkOutboundMessage('الرقم 29001011234567')).toEqual({
      ok: false,
      reason: 'national_id',
    })
  })
  it('رقم قومي مفصول بمسافات يُحظر بعد التطبيع', () => {
    expect(checkOutboundMessage('2900 1011 2345 67')).toEqual({
      ok: false,
      reason: 'national_id',
    })
  })
  it('رقم بطاقة 16 رقماً يُحظر', () => {
    expect(checkOutboundMessage('4111 1111 1111 1111')).toEqual({
      ok: false,
      reason: 'card_number',
    })
  })
  it('مبلغ وتاريخ لا يُحظران', () => {
    expect(checkOutboundMessage('المتبقي 1250 ج.م قبل 2026-12-01')).toEqual({
      ok: true,
    })
  })
})
