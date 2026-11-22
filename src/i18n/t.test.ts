import { describe, expect, it } from 'vitest'
import { t } from './t'
import { pluralCategory } from './format'

describe('t — قاموس i18n (عربي افتراضي)', () => {
  it('مفتاح بسيط يطابق النص القائم حرفياً', () => {
    expect(t('common.retry')).toBe('حاول تاني')
    expect(t('common.loading')).toBe('جارٍ التحميل…')
    expect(t('shell.nav.invoices')).toBe('الفواتير')
    expect(t('shell.nav.children')).toBe('الأطفال')
  })
  it('استيفاء {name} من الوسائط', () => {
    expect(t('common.resultsCount', { count: 0 })).toBe('0 نتيجة')
    expect(t('home.greeting', { name: 'أم يوسف' })).toBe('أهلاً، أم يوسف')
  })
  it('صيغ جمع CLDR لعدّاد الإثباتات', () => {
    expect(t('paymentProofs.pendingCount', { count: 0 })).toBe(
      'لا إثباتات بانتظار المراجعة',
    )
    expect(t('paymentProofs.pendingCount', { count: 1 })).toBe(
      'إثبات واحد بانتظار المراجعة',
    )
    expect(t('paymentProofs.pendingCount', { count: 2 })).toBe(
      'إثباتان بانتظار المراجعة',
    )
    expect(t('paymentProofs.pendingCount', { count: 7 })).toBe(
      '7 إثباتات بانتظار المراجعة',
    )
    expect(t('paymentProofs.pendingCount', { count: 50 })).toBe(
      '50 إثباتاً بانتظار المراجعة',
    )
    expect(t('paymentProofs.pendingCount', { count: 100 })).toBe(
      '100 إثبات بانتظار المراجعة',
    )
  })
  it('وسيط مفقود يبقى ظاهراً بدل فراغ صامت', () => {
    expect(t('common.resultsCount')).toBe('{count} نتيجة')
  })
  it('أجزاء بروتوتايب لا تتسرب من سلسلة الوراثة (تصليب موروث)', () => {
    const raw = t as unknown as (k: string) => string
    expect(raw('__proto__')).toBe('__proto__')
    expect(raw('common.__proto__')).toBe('common.__proto__')
    expect(raw('common.constructor')).toBe('common.constructor')
    expect(raw('common.toString')).toBe('common.toString')
  })
})

describe('pluralCategory — فئات CLDR العربية الست', () => {
  it('zero/one/two/few/many/other', () => {
    expect(pluralCategory(0)).toBe('zero')
    expect(pluralCategory(1)).toBe('one')
    expect(pluralCategory(2)).toBe('two')
    expect(pluralCategory(5)).toBe('few')
    expect(pluralCategory(50)).toBe('many')
    expect(pluralCategory(100)).toBe('other')
    expect(pluralCategory(102)).toBe('other')
  })
})
