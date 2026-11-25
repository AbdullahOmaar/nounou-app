/**
 * خطوات مسار الترخيص (4.12) — قائمة إرشادية ثابتة بالترتيب الشائع
 * لترخيص حضانة في مصر. ليست مرجعاً قانونياً: المتطلبات تختلف بحسب
 * المحافظة ونوع الترخيص، والمرجع مديرية التضامن الاجتماعي المختصة
 * (docs/LICENSING.md). المفاتيح ثابتة لأن حالاتها تُخزن في القاعدة.
 */
export const LICENSING_STEP_KEYS = [
  'premises',
  'commercial_register',
  'tax_card',
  'civil_protection',
  'staff_papers',
  'health_certs',
  'apply_directorate',
  'inspection',
  'temp_license',
  'permanent_license',
] as const

export type LicensingStepKey = (typeof LICENSING_STEP_KEYS)[number]
export type LicensingStepStatus = 'todo' | 'done' | 'na'
