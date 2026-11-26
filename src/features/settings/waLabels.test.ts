import { describe, expect, it } from 'vitest'
import type { I18nKey, Params } from '../../i18n/dict'
import { waStatusLabel, waTemplateLabel } from './waLabels'

const fakeT = (key: I18nKey, _params?: Params): string => key

describe('waStatusLabel — لا كود حالة خام يصل للمستخدم أبداً', () => {
  it('كل حالة داخلية معروفة ليها مفتاح وصف بشري', () => {
    expect(waStatusLabel(fakeT, 'queued')).toBe('settings.wa.statusQueued')
    expect(waStatusLabel(fakeT, 'blocked_kill_switch')).toBe(
      'settings.wa.statusBlockedKillSwitch',
    )
    expect(waStatusLabel(fakeT, 'blocked_not_configured')).toBe(
      'settings.wa.statusBlockedNotConfigured',
    )
    expect(waStatusLabel(fakeT, 'blocked_not_enabled')).toBe(
      'settings.wa.statusBlockedNotEnabled',
    )
    expect(waStatusLabel(fakeT, 'blocked_template')).toBe(
      'settings.wa.statusBlockedTemplate',
    )
  })

  it('حالة غير معروفة تسقط لوصف عام مهذب — مش الكود نفسه', () => {
    expect(waStatusLabel(fakeT, 'something_new')).toBe('settings.wa.statusOther')
    expect(waStatusLabel(fakeT, '')).toBe('settings.wa.statusOther')
  })
})

describe('waTemplateLabel — لا اسم قالب خام', () => {
  it('القوالب الثلاثة المعروفة + سقوط مهذب', () => {
    expect(waTemplateLabel(fakeT, 'gate_test')).toBe('settings.wa.tplGateTest')
    expect(waTemplateLabel(fakeT, 'fee_reminder')).toBe(
      'settings.wa.tplFeeReminder',
    )
    expect(waTemplateLabel(fakeT, 'pickup_code')).toBe(
      'settings.wa.tplPickupCode',
    )
    expect(waTemplateLabel(fakeT, 'other_tpl')).toBe('settings.wa.tplOther')
  })
})
