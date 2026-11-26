import type { I18nKey, Params } from '../../i18n/dict'

type TFn = (key: I18nKey, params?: Params) => string

/**
 * تسميات مهذبة لحالات/قوالب سجل واتساب (2.2): الإرسال الفعلي لسه
 * مش مُطلق (محتاج رقم Meta معتمد — قرار مالك)، فالمستخدم ما
 * يشوفش أكواد الحالة الداخلية أبداً (قاعدة المالك 2026-11-26:
 * لا خطأ/كود خام من فيتشر لسه مش حي) — كل حالة ليها وصف بشري.
 */
export function waStatusLabel(t: TFn, status: string): string {
  switch (status) {
    case 'queued':
      return t('settings.wa.statusQueued')
    case 'blocked_kill_switch':
      return t('settings.wa.statusBlockedKillSwitch')
    case 'blocked_not_configured':
      return t('settings.wa.statusBlockedNotConfigured')
    case 'blocked_not_enabled':
      return t('settings.wa.statusBlockedNotEnabled')
    case 'blocked_template':
      return t('settings.wa.statusBlockedTemplate')
    default:
      return t('settings.wa.statusOther')
  }
}

export function waTemplateLabel(t: TFn, template: string): string {
  switch (template) {
    case 'gate_test':
      return t('settings.wa.tplGateTest')
    case 'fee_reminder':
      return t('settings.wa.tplFeeReminder')
    case 'pickup_code':
      return t('settings.wa.tplPickupCode')
    default:
      return t('settings.wa.tplOther')
  }
}
