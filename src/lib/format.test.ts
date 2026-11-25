import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ageLabel,
  currentPeriod,
  fmtWeekday,
  fmtWeekdayDate,
  formatClock12,
  formatMoney,
  shiftISODate,
  todayISO,
  waLink,
  waLinkWithText,
} from './format'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatMoney — تنسيق العملة من القاموس', () => {
  it('أعداد صحيحة وكسور معروضة بقروش صحيحة', () => {
    expect(formatMoney(800)).toBe('800 ج.م')
    expect(formatMoney(80.125)).toBe('80.13 ج.م')
    expect(formatMoney(0)).toBe('0 ج.م')
    expect(formatMoney(null)).toBe('0 ج.م')
  })
})

describe('ageLabel — عمر الطفل من تاريخ الميلاد', () => {
  it('سنوات وشهور بصيغ الجمع العربية', () => {
    const now = new Date('2026-11-22T00:00:00')
    expect(ageLabel('2022-11-22', now)).toBe('4 سنوات')
    expect(ageLabel('2025-11-22', now)).toBe('سنة')
    expect(ageLabel('2026-05-22', now)).toBe('6 شهور')
  })
  it('تاريخ مستقبلي أو فارغ: null', () => {
    const now = new Date('2026-11-22T00:00:00')
    expect(ageLabel('2027-01-01', now)).toBeNull()
    expect(ageLabel(null, now)).toBeNull()
    expect(ageLabel('', now)).toBeNull()
  })
})

describe('تواريخ ISO وفترات', () => {
  it('todayISO/currentPeriod مع ساعة مثبّتة', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T15:00:00'))
    expect(todayISO()).toBe('2026-11-22')
    expect(currentPeriod()).toBe('2026-11')
  })
  it('shiftISODate عبر حدود الشهور والسنوات', () => {
    expect(shiftISODate('2026-11-22', -1)).toBe('2026-11-21')
    expect(shiftISODate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftISODate('2024-02-28', 1)).toBe('2024-02-29')
  })
})

describe('fmtWeekday — اسم يوم الأسبوع مثبّت على القاهرة', () => {
  it('2026-11-25 أربعاء مهما كان توقيت المتصفح', () => {
    // التاريخ يُبنى ظهراً فلا يتأثر بإزاحة UTC؛ والتثبيت على القاهرة
    // يمنع انزلاق اليوم قرب منتصف الليل
    expect(fmtWeekday('2026-11-25')).toBe('الأربعاء')
    expect(fmtWeekday('2026-11-24')).toBe('الثلاثاء')
  })
  it('تاريخ فارغ: سلسلة فارغة', () => {
    expect(fmtWeekday('')).toBe('')
  })
})

describe('waLink — روابط واتساب آمنة', () => {
  it('يبني رابطاً من رقم مصري محلي ويشفر النص', () => {
    expect(waLink('01001234567')).toBe('https://wa.me/201001234567')
    expect(waLinkWithText('01001234567', 'أهلاً')).toBe(
      'https://wa.me/201001234567?text=%D8%A3%D9%87%D9%84%D8%A7%D9%8B',
    )
  })
  it('رقم دولي يبقى كما هو وأرقام قصيرة تُرفض', () => {
    expect(waLink('+201001234567')).toBe('https://wa.me/201001234567')
    expect(waLink('123')).toBeNull()
    expect(waLink(null)).toBeNull()
  })
})

describe('تثبيت توقيت القاهرة — عيبا الفحص الحي 1+2 (2026-11-25)', () => {
  it('وصول منتصف الليل UTC يظهر 2:00 ص بتوقيت القاهرة مهما كانت منطقة الجهاز', () => {
    expect(formatClock12('2026-11-25T00:00:31.124Z')).toBe('2:00 ص')
  })
  it('يوم 25 نوفمبر 2026 = الأربعاء (لا الثلاثاء) بتوقيت القاهرة', () => {
    expect(fmtWeekdayDate('2026-11-25')).toContain('الأربعاء')
    expect(fmtWeekdayDate('2026-11-25')).toContain('25 نوفمبر 2026')
  })
})
